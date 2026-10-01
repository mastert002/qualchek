// Self-serve signup: a workspace, its first administrator, and a trial.
//
// Mounted outside the authenticated routers, and deliberately so - there is no
// tenant yet, which is the whole point. Creating one has to cross the tenant
// boundary, so it goes through create_tenant(), a SECURITY DEFINER function
// that inserts the tenant and its first user in a single statement. Doing both
// in one statement matters: a failure between them would leave a workspace
// nobody can sign in to, and no way to notice except a support request.

const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb, getPool } = require('../db/database');
const { withTenant } = require('../db/tenantContext');
const { signToken } = require('../middleware/auth');
const refresh = require('../lib/refresh');
const { setSessionCookie } = require('../lib/sessionCookie');

const router = express.Router();

const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 14);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

const normaliseEmail = e => String(e || '').trim().toLowerCase();

/**
 * A URL-safe handle derived from the workspace name. Punctuation and accents
 * are stripped rather than encoded, so "Açme Ltd." becomes "acme-ltd" instead
 * of something unreadable.
 */
function slugify(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * Slugs are unique across the install, and two companies with the same name is
 * ordinary rather than exceptional. Rather than rejecting the second one, find
 * the first free suffix.
 */
async function uniqueSlug(pool, base) {
  const root = base || 'workspace';
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    // Through slug_in_use rather than a direct SELECT: tenants is policy-scoped
    // and signup has no tenant context, so a plain query sees nothing and every
    // workspace would be told its preferred slug was free.
    const { rows } = await pool.query('SELECT slug_in_use($1) AS taken', [candidate]);
    if (!rows[0].taken) return candidate;
  }
  // Fall back to something that cannot collide rather than failing the signup.
  return `${root}-${uuidv4().slice(0, 6)}`;
}

// POST /api/signup
router.post('/', async (req, res) => {
  try {
    const workspace = String(req.body.workspace || '').trim();
    const name = String(req.body.name || '').trim();
    const email = normaliseEmail(req.body.email);
    const password = String(req.body.password || '');

    if (!workspace) return res.status(400).json({ error: 'Workspace name is required' });
    if (!name) return res.status(400).json({ error: 'Your name is required' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (password.length < MIN_PASSWORD) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
    }

    const pool = getPool();

    // email_in_use crosses tenants on purpose: one address belongs to one
    // workspace, so this has to consider every workspace. It returns a boolean
    // and never says which one, so signup cannot be used to discover where
    // somebody has an account.
    const { rows: used } = await pool.query('SELECT email_in_use($1) AS taken', [email]);
    if (used[0] && used[0].taken) {
      return res.status(409).json({
        error: 'An account already exists for that email address. Sign in instead.',
      });
    }

    const tenantId = 'tnt_' + uuidv4();
    const userId = 'usr_' + uuidv4();
    const slug = await uniqueSlug(pool, slugify(workspace));
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86400_000).toISOString();

    await pool.query(
      'SELECT create_tenant($1,$2,$3,$4,$5,$6,$7,$8)',
      [tenantId, workspace, slug, trialEndsAt, userId, name, email, bcrypt.hashSync(password, 10)]
    );

    // Signed in immediately - a trial that makes you check your email before
    // seeing anything loses people who were ready to look.
    return await withTenant(pool, tenantId, async () => {
      const db = getDb();
      const user = await db.prepare(
        'SELECT id, tenant_id, name, email, role, is_active, is_super_admin FROM users WHERE id = ?'
      ).get(userId);
      const tenant = await db.prepare(
        'SELECT id, name, slug, status, plan, trial_ends_at FROM tenants WHERE id = ?'
      ).get(tenantId);

      setSessionCookie(req, res, await refresh.issue(userId));
      return res.status(201).json({ user, tenant, token: signToken(user) });
    });
  } catch (err) {
    // A unique-violation here means two signups raced for the same slug or
    // address between the check and the insert.
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'That workspace or email was just taken. Try again.' });
    }
    console.error('signup:', err);
    return res.status(500).json({ error: 'Could not create the workspace' });
  }
});

module.exports = router;
