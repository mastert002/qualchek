const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb, getPool, nowISO } = require('../db/database');
const { withTenant } = require('../db/tenantContext');
const { authenticate, signToken } = require('../middleware/auth');
const { sendInvite, baseUrlFrom } = require('../lib/mailer');
const audit = require('../lib/audit');
const refresh = require('../lib/refresh');
const { setSessionCookie, clearSessionCookie, readSessionCookie } = require('../lib/sessionCookie');

const router = express.Router();

const { JWT_SECRET } = require('../lib/secret');

// Invite tokens are stateless. The signing key mixes in the user's CURRENT
// password hash, so the moment a password is set the hash changes and every
// previously issued link stops verifying - single-use without a tokens table.
// That matters here because initDb() returns early when `users` already exists,
// so a new table would never be created on the live database.
// An email address identifies one person, so it must match one account no
// matter how it is typed. Postgres compares strings case-sensitively, so
// "Ada@x.com", "ada@x.com" and "ada@x.com " were three distinct accounts for
// one real mailbox. Normalise on write and compare case-insensitively.
const normaliseEmail = e => String(e || '').trim().toLowerCase();

// Deliberately permissive: the point is to reject obvious junk (spaces, a
// missing @ or domain) so an invite is not sent into the void, not to police
// exotic-but-valid addresses.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Acting ON an admin (edit, delete, deactivate) requires super-admin rights.
// Ordinary admins manage testers and viewers; only a super admin manages peers.
const isSuper = u => u && u.is_super_admin === true;

async function countOtherActiveSupers(db, excludeId) {
  const row = await db
    .prepare('SELECT COUNT(*) AS c FROM users WHERE is_super_admin = TRUE AND is_active = TRUE AND id != ?')
    .get(excludeId);
  return Number(row.c);
}

const inviteKey = passwordHash => `${JWT_SECRET}|invite|${passwordHash}`;

// How long an invite link stays usable. Kept in one place and passed to the
// email template too, so the wording in the message can never drift from the
// value actually enforced. Override with INVITE_TTL_MINUTES.
const INVITE_TTL_MINUTES = Number(process.env.INVITE_TTL_MINUTES || 60);

// purpose is 'invite' (an admin created the account) or 'reset' (the user
// asked from the sign-in page). Both set a password the same way; the
// distinction only changes the email wording and the audit entry.
const signInvite = (id, passwordHash, purpose = 'invite') =>
  jwt.sign({ id, purpose }, inviteKey(passwordHash), {
    expiresIn: `${INVITE_TTL_MINUTES}m`,
  });

// Decode (unverified) only to learn which user the token names, load their
// current hash, then verify properly. Nothing is trusted until verify passes.
async function resolveInvite(db, token) {
  const claimed = jwt.decode(token);
  if (!claimed || !claimed.id) throw new Error('invalid');
  const user = await db
    .prepare('SELECT id, name, email, password_hash, is_active FROM users WHERE id = ?')
    .get(claimed.id);
  if (!user) throw new Error('invalid');
  // A deactivated account must not be revivable through an old invite link.
  if (user.is_active === false) throw new Error('invalid');
  const payload = jwt.verify(token, inviteKey(user.password_hash));
  if (payload.purpose !== 'invite' && payload.purpose !== 'reset') throw new Error('invalid');
  return { ...user, purpose: payload.purpose };
}

async function issueInvite(req, user, purpose = 'invite') {
  const token = signInvite(user.id, user.password_hash, purpose);
  const link = `${baseUrlFrom(req)}/set-password?token=${encodeURIComponent(token)}`;
  const result = await sendInvite({
    to: user.email,
    name: user.name,
    link,
    expiresInMinutes: INVITE_TTL_MINUTES,
    mode: purpose,
  });
  // If the mail did not go out, hand the link back so the admin can pass it on
  // manually. No escalation: an admin can already reset anyone's password.
  // When it did send, withhold it - there is no reason to copy it around.
  return result.delivered ? { delivered: true } : result;
}

// Creating accounts is an ADMIN action. This route used to be public with
// 'admin' among the accepted roles, which let anyone grant themselves full
// access. It must stay behind authenticate plus an admin check.
router.post('/register', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can create users' });
    const { name, password, role = 'tester' } = req.body;
    const email = normaliseEmail(req.body.email);
    if (!name || !email) return res.status(400).json({ error: 'name and email are required' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    const db = getDb();
    const existing = await db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(email);
    if (existing) return res.status(409).json({ error: 'That email is already registered' });
    const id = uuidv4();
    // No password supplied means "invite them". Store an unguessable random
    // secret so the account exists but cannot be signed into until the invite
    // is accepted - never an empty or predictable placeholder.
    const invited = !password;
    const password_hash = bcrypt.hashSync(password || crypto.randomBytes(32).toString('hex'), 10);
    const allowedRoles = ['admin', 'tester', 'viewer'];
    const assignedRole = allowedRoles.includes(role) ? role : 'tester';
    // Creating an admin is the same privilege as promoting one, so it needs the
    // same guard - otherwise an ordinary admin could mint admins at will.
    if (assignedRole === 'admin' && !isSuper(req.user)) {
      return res.status(403).json({ error: 'Only a super admin can create an admin' });
    }
    await db.prepare('INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, email, password_hash, assignedRole, nowISO());
    const user = await db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(id);
    const invite = invited ? await issueInvite(req, { id, name, email, password_hash }) : null;
    await audit.record(req, 'user.created', { type: 'user', id, label: email },
      { role: assignedRole, invited, invite_delivered: invite ? invite.delivered : null });
    res.status(201).json({ user, invited, invite });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

// Activate or deactivate an account. Deactivating keeps every record the user
// created - unlike delete, which would strip that history.
router.put('/users/:id/active', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot deactivate your own account' });
    const active = req.body.active !== false;
    const db = getDb();
    const target = await db.prepare('SELECT id, name, role, is_active, is_super_admin FROM users WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!active && target.role === 'admin' && !isSuper(req.user)) {
      return res.status(403).json({ error: 'Only a super admin can deactivate an admin' });
    }
    if (!active && target.is_super_admin === true && (await countOtherActiveSupers(db, target.id)) === 0) {
      return res.status(400).json({ error: 'This is the last super admin and cannot be deactivated' });
    }
    // Never allow the last active admin to be switched off - that would leave
    // nobody able to administer the system, with no way back in.
    if (!active && target.role === 'admin') {
      const others = await db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = TRUE AND id != ?").get(req.params.id);
      if (Number(others.c) === 0) return res.status(400).json({ error: 'This is the last active admin. Promote another admin first.' });
    }
    await db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(active, req.params.id);
    // authenticate() already rejects a deactivated account on every request,
    // so this is belt and braces - but it also stops the refresh endpoint
    // handing out new access tokens against a stale row.
    if (!active) await refresh.revokeAllForUser(req.params.id);
    await audit.record(req, active ? 'user.activated' : 'user.deactivated',
      { type: 'user', id: target.id, label: target.name }, { role: target.role });
    res.json({ success: true, id: req.params.id, is_active: active });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

// Grant or revoke super-admin status. Only a super admin can do this, so the
// tier can never be self-assigned by an ordinary admin.
router.put('/users/:id/super-admin', authenticate, async (req, res) => {
  try {
    if (!isSuper(req.user)) return res.status(403).json({ error: 'Only a super admin can change super admin status' });
    const grant = req.body.super !== false;
    const db = getDb();
    const target = await db.prepare('SELECT id, name, role, is_super_admin FROM users WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    // Keep the tiers coherent: super admin is an extra layer on top of admin,
    // never a way to hand broad powers to a tester or viewer.
    if (grant && target.role !== 'admin') {
      return res.status(400).json({ error: 'Only an admin can be made a super admin. Change their role to admin first.' });
    }
    // Removing your own flag is how an account locks itself out of the tier
    // with no way back, so require another super admin to do it.
    if (!grant && target.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot remove your own super admin status. Ask another super admin.' });
    }
    if (!grant && (await countOtherActiveSupers(db, target.id)) === 0) {
      return res.status(400).json({ error: 'This is the last super admin and cannot be demoted' });
    }
    await db.prepare('UPDATE users SET is_super_admin = ? WHERE id = ?').run(grant, req.params.id);
    await audit.record(req, grant ? 'user.super_admin_granted' : 'user.super_admin_revoked',
      { type: 'user', id: target.id, label: target.name });
    res.json({ success: true, id: req.params.id, is_super_admin: grant });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

// Read the audit trail. Admins only. Read-only by design: there is no route
// that edits or deletes entries, which is what makes the record trustworthy.
router.get('/audit', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
    const db = getDb();
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const action = req.query.action ? String(req.query.action) : null;
    const q = req.query.q ? `%${String(req.query.q).toLowerCase()}%` : null;

    // Built as two fixed shapes rather than string concatenation so the
    // parameter order can never drift from the placeholders.
    let rows;
    if (action && q) {
      rows = await db.prepare(`SELECT * FROM audit_log WHERE action = ? AND (LOWER(actor_name) LIKE ? OR LOWER(actor_email) LIKE ? OR LOWER(target_label) LIKE ?) ORDER BY at DESC LIMIT ? OFFSET ?`).all(action, q, q, q, limit, offset);
    } else if (action) {
      rows = await db.prepare(`SELECT * FROM audit_log WHERE action = ? ORDER BY at DESC LIMIT ? OFFSET ?`).all(action, limit, offset);
    } else if (q) {
      rows = await db.prepare(`SELECT * FROM audit_log WHERE LOWER(actor_name) LIKE ? OR LOWER(actor_email) LIKE ? OR LOWER(target_label) LIKE ? ORDER BY at DESC LIMIT ? OFFSET ?`).all(q, q, q, limit, offset);
    } else {
      rows = await db.prepare(`SELECT * FROM audit_log ORDER BY at DESC LIMIT ? OFFSET ?`).all(limit, offset);
    }

    const total = await db.prepare('SELECT COUNT(*) AS c FROM audit_log').get();
    const actions = await db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').all();
    res.json({
      entries: rows.map(r => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null })),
      total: Number(total.c),
      actions: actions.map(a => a.action),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

// Re-send an invite (admin only).
router.post('/users/:id/invite', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
    const db = getDb();
    const user = await db.prepare('SELECT id, name, email, password_hash, role FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    // Re-issuing an invite resets that account's password, so it is the same
    // authority as editing them: only a super admin may do it to an admin.
    if (user.role === 'admin' && user.id !== req.user.id && !isSuper(req.user)) {
      return res.status(403).json({ error: 'Only a super admin can send an invite to another admin' });
    }
    const invite = await issueInvite(req, user);
    await audit.record(req, 'invite.sent', { type: 'user', id: user.id, label: user.email },
      { delivered: invite.delivered });
    res.json({ success: true, invite });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

// Public: check a link is still good before rendering the form.
// Self-service reset from the sign-in page. Public, and for every account.
//
// The reply is the same whether or not the address exists, so this cannot be
// used to discover who has an account. (Response time still varies slightly
// when a mail is actually sent; the serverless runtime freezes on return, so
// the send cannot be deferred past the response.)
//
// Reuses the invite token: it is signed with the current password hash, so a
// reset link dies the moment the password changes - by this link, by another
// one, or by the super admin's own change-password dialog.
router.post('/forgot-password', async (req, res) => {
  const generic = { success: true, message: 'If an account exists for that address, a reset link has been sent.' };
  try {
    const email = normaliseEmail(req.body.email);
    if (!email || !EMAIL_RE.test(email)) return res.json(generic);

    const db = getDb();
    const user = await db
      .prepare('SELECT id, name, email, password_hash, is_active FROM users WHERE LOWER(email) = ?')
      .get(email);

    // Unknown address or deactivated account: say nothing different.
    if (user && user.is_active !== false) {
      await issueInvite(req, user, 'reset');
      await audit.record(req, 'password.reset_requested', { type: 'user', id: user.id, label: user.email }, null, user);
    }
    res.json(generic);
  } catch (err) {
    console.error(err);
    // Even on failure, do not leak anything via a different shape.
    res.json(generic);
  }
});

router.get('/invite/verify', async (req, res) => {
  try {
    const user = await resolveInvite(getDb(), String(req.query.token || ''));
    res.json({ valid: true, name: user.name, email: user.email, mode: user.purpose });
  } catch {
    res.status(400).json({ valid: false, error: 'This link is invalid, expired, or already used.' });
  }
});

// Public: redeem the link, set the password, and sign them in.
router.post('/invite/accept', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const db = getDb();
    let user;
    try {
      user = await resolveInvite(db, String(token || ''));
    } catch {
      return res.status(400).json({ error: 'This link is invalid, expired, or already used.' });
    }
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(bcrypt.hashSync(password, 10), user.id);
    const fresh = await db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(user.id);
    // No req.user here — the person is not signed in yet, so they are the actor.
    const action = user.purpose === 'reset' ? 'password.reset' : 'invite.redeemed';
    await audit.record(req, action, { type: 'user', id: fresh.id, label: fresh.email }, null, fresh);
    // Setting a password ends every other session for this account: an invite
    // redeemed after a forgotten password should not leave an older session,
    // possibly someone else's, still running.
    await refresh.revokeAllForUser(fresh.id);
    setSessionCookie(req, res, await refresh.issue(fresh.id));
    res.json({ user: fresh, token: signToken(fresh) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    // Sign-in is the one read that must cross tenants: the address is typed on
    // a shared login page, so which workspace it belongs to is the thing being
    // looked up. find_login is a SECURITY DEFINER function for exactly this -
    // a narrow, auditable exception instead of giving the app a role that
    // ignores row-level security. It returns one row and nothing else.
    const pool = getPool();
    const { rows } = await pool.query('SELECT * FROM find_login($1)', [normaliseEmail(email)]);
    const found = rows[0];

    // bcrypt against a dummy hash when the address is unknown, so a missing
    // account and a wrong password take the same time to reject.
    const hash = found ? found.password_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const passwordOk = bcrypt.compareSync(password, hash);

    if (!found || !passwordOk) {
      await audit.record(req, 'auth.login_failed',
        { type: 'user', id: found ? found.user_id : null, label: normaliseEmail(email) },
        null, { id: found ? found.user_id : null, email: normaliseEmail(email) });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    // Only after the password check, so neither can be used to discover which
    // addresses belong to real accounts.
    if (found.is_active === false) {
      return res.status(403).json({ error: 'This account has been deactivated. Contact an administrator.' });
    }
    if (found.tenant_status === 'suspended') {
      return res.status(403).json({ error: 'This workspace has been suspended. Contact support.' });
    }

    // Everything from here reads and writes inside the tenant the address
    // belongs to.
    return await withTenant(pool, found.tenant_id, async () => {
      const db = getDb();
      const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(found.user_id);
      const { password_hash, ...safeUser } = user;
      await audit.record(req, 'auth.login', { type: 'user', id: user.id, label: user.email }, null, safeUser);
      // A new sign-in starts its own rotation family, so signing in again on
      // another machine does not disturb this session or vice versa.
      setSessionCookie(req, res, await refresh.issue(user.id));
      // Awaited rather than fire-and-forget: the request's client is released
      // when this function returns, and a query started after that would be
      // using a connection that belongs to someone else.
      await refresh.prune().catch(() => {});
      return res.json({ user: safeUser, token: signToken(safeUser) });
    });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// Exchange the refresh cookie for a new access token. Deliberately NOT behind
// authenticate: the whole point is that it works once the access token has
// expired. The cookie is the credential.
router.post('/refresh', async (req, res) => {
  const raw = readSessionCookie(req);
  if (!raw) return res.status(401).json({ error: 'No session' });
  try {
    // Which workspace this cookie belongs to is not knowable from the cookie
    // itself, and refresh_tokens is policy-scoped - so resolve the tenant
    // first, then do everything else inside it.
    const pool = getPool();
    const { rows } = await pool.query('SELECT find_refresh_tenant($1) AS tenant_id', [refresh.sha256(raw)]);
    const tenantId = rows[0] && rows[0].tenant_id;
    if (!tenantId) {
      clearSessionCookie(req, res);
      return res.status(401).json({ error: 'Session ended' });
    }
    return await withTenant(pool, tenantId, async () => {
    const { userId, raw: next } = await refresh.rotate(raw);
    const db = getDb();
    // Re-read rather than trusting the row: a user deactivated mid-session
    // must not be handed a fresh access token.
    const user = await db.prepare(
      'SELECT id, name, email, role, is_active, is_super_admin FROM users WHERE id = ?'
    ).get(userId);
    if (!user || user.is_active === false) {
      await refresh.revokeAllForUser(userId);
      clearSessionCookie(req, res);
      return res.status(401).json({ error: 'Session ended' });
    }
    setSessionCookie(req, res, next);
    return res.json({ user, token: signToken(user) });
    });
  } catch {
    // Unknown, expired and replayed all land here and look identical from
    // outside, so nothing about the session can be probed from the response.
    clearSessionCookie(req, res);
    res.status(401).json({ error: 'Session ended' });
  }
});

// Sign out. Ends this session server-side, which is the part the old
// client-only logout could never do.
router.post('/logout', async (req, res) => {
  try {
    await refresh.revokeByToken(readSessionCookie(req));
  } catch { /* signing out must always appear to succeed */ }
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

router.get('/me', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const user = await db.prepare('SELECT id, name, email, role, created_at, is_active, is_super_admin FROM users WHERE id = ?').get(req.user.id);
    res.json(user);
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// Change your own password. Deliberately limited to super admins: everyone
// else sets a password only through an invite link, and gets a fresh one by
// having an admin resend the invite. That keeps "admins never handle
// passwords" true while still giving the top tier a way to rotate their own
// without depending on email.
//
// The current password is required so a walked-away session cannot be turned
// into a permanent takeover. Changing the hash also voids any outstanding
// invite link for this account, since invite tokens are signed with it.
router.put('/me/password', authenticate, async (req, res) => {
  try {
    if (req.user.is_super_admin !== true) {
      return res.status(403).json({ error: 'Only a super admin can change their password here' });
    }
    const current = String(req.body.current_password || '');
    const next = String(req.body.new_password || '');
    if (!current) return res.status(400).json({ error: 'Enter your current password' });
    if (next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
    if (next === current) return res.status(400).json({ error: 'New password must be different from the current one' });

    const db = getDb();
    const row = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!row || !bcrypt.compareSync(current, row.password_hash)) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), req.user.id);
    await audit.record(req, 'user.password_changed', { type: 'user', id: req.user.id, label: req.user.email });
    // The reason to change a password in a hurry is that a session may have
    // leaked, so this has to end every session - including any the attacker
    // holds. The caller keeps working: they get a fresh family immediately,
    // and their current access token stays valid for its last few minutes.
    await refresh.revokeAllForUser(req.user.id);
    setSessionCookie(req, res, await refresh.issue(req.user.id));
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/users', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const users = await db.prepare('SELECT id, name, email, role, created_at, is_active, is_super_admin FROM users').all();
    res.json(users);
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.put('/users/:id', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can edit users' });
    const { name, role, password } = req.body;
    const email = req.body.email === undefined ? undefined : normaliseEmail(req.body.email);
    const db = getDb();
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    // Editing another admin is a super-admin action. Editing yourself is not.
    if (user.role === 'admin' && user.id !== req.user.id && !isSuper(req.user)) {
      return res.status(403).json({ error: 'Only a super admin can edit another admin' });
    }
    // Likewise, only a super admin may promote someone into the admin tier.
    if (role === 'admin' && user.role !== 'admin' && !isSuper(req.user)) {
      return res.status(403).json({ error: 'Only a super admin can promote someone to admin' });
    }
    // Nobody changes their own role - it is the one edit that could remove your
    // own access (or, in a future tier, raise it) with no second pair of eyes.
    if (role && role !== user.role && user.id === req.user.id) {
      return res.status(403).json({ error: 'You cannot change your own role' });
    }
    // A super admin is an admin with an extra flag. Letting the role move while
    // the flag is set would leave, say, a "viewer" holding super-admin powers.
    if (role && role !== user.role && user.is_super_admin === true) {
      return res.status(400).json({ error: 'Remove super admin status before changing this role' });
    }
    if (email && email !== normaliseEmail(user.email)) {
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
      const conflict = await db.prepare('SELECT id FROM users WHERE LOWER(email) = ? AND id != ?').get(email, req.params.id);
      if (conflict) return res.status(409).json({ error: 'That email is already in use by another account' });
    }
    const allowedRoles = ['admin', 'tester', 'viewer'];
    const updatedName = name || user.name;
    const updatedEmail = email || user.email;
    const updatedRole = allowedRoles.includes(role) ? role : user.role;
    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      await db.prepare('UPDATE users SET name=?, email=?, role=?, password_hash=? WHERE id=?').run(updatedName, updatedEmail, updatedRole, hash, req.params.id);
      // An admin resetting someone's password ends that person's sessions.
      // Otherwise the reset looks like a remedy while the old session, which
      // may be the reason for the reset, keeps running.
      await refresh.revokeAllForUser(req.params.id);
    } else {
      await db.prepare('UPDATE users SET name=?, email=?, role=? WHERE id=?').run(updatedName, updatedEmail, updatedRole, req.params.id);
    }
    const updated = await db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(req.params.id);
    const changes = audit.diff(user, updated, ['name', 'email', 'role']);
    await audit.record(req, 'user.updated', { type: 'user', id: updated.id, label: updated.email },
      { changes, password_reset: !!password });
    res.json(updated);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/users/:id', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can delete users' });
    if (req.user.id === req.params.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    const db = getDb();
    const target = await db.prepare('SELECT id, role, is_super_admin FROM users WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'admin' && !isSuper(req.user)) {
      return res.status(403).json({ error: 'Only a super admin can delete an admin' });
    }
    // Never remove the last super admin: nobody could then manage admins, and
    // there is no way to grant the flag back through the UI.
    if (target.is_super_admin === true && (await countOtherActiveSupers(db, target.id)) === 0) {
      return res.status(400).json({ error: 'This is the last super admin and cannot be deleted' });
    }
    // Read the full record first: once deleted there is nothing left to
    // describe it, and identifying the person is the whole point.
    const gone = await db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(req.params.id);
    await db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    await audit.record(req, 'user.deleted', { type: 'user', id: gone.id, label: gone.email },
      { name: gone.name, role: gone.role });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// Get all projects and membership status for a user
router.get('/users/:id/projects', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
    const db = getDb();
    const projects = await db.prepare(`
      SELECT p.id, p.name,
        pm.role as member_role
      FROM projects p
      LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
      ORDER BY p.name
    `).all(req.params.id);
    res.json(projects);
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// Add or remove a user from a project
router.put('/users/:id/projects/:projectId', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
    const { action, role = 'tester' } = req.body; // action: 'add' | 'remove'
    const db = getDb();
    if (action === 'add') {
      await db.prepare(`INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)
        ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`)
        .run(req.params.projectId, req.params.id, role);
    } else {
      await db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?')
        .run(req.params.projectId, req.params.id);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/api-key', authenticate, async (req, res) => {
  try {
    const db = getDb();
    const row = await db.prepare('SELECT api_key FROM users WHERE id = ?').get(req.user.id);
    res.json({ api_key: row?.api_key || null });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/api-key', authenticate, async (req, res) => {
  try {
    const { randomBytes } = require('crypto');
    const key = 'tm_' + randomBytes(24).toString('hex');
    const db = getDb();
    await db.prepare('UPDATE users SET api_key = ? WHERE id = ?').run(key, req.user.id);
    res.json({ api_key: key });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

router.delete('/api-key', authenticate, async (req, res) => {
  try {
    const db = getDb();
    await db.prepare('UPDATE users SET api_key = NULL WHERE id = ?').run(req.user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;