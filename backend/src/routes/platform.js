// The QualChek operator console: reviewing trial requests.
//
// Platform operators are not tenant users. They have their own table, their own
// sign-in, and their own token scope - a tenant token will not open this, and a
// platform token will not open a workspace. Mixing the two would mean either
// putting an operator inside somebody's workspace or carving an exception into
// every tenant policy.

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getPool } = require('../db/database');
const { JWT_SECRET } = require('../lib/secret');

const router = express.Router();

const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 14);
// The claim that separates the two kinds of token. Without it a tenant admin's
// token would open the console simply by being validly signed.
const SCOPE = 'platform';

function signPlatformToken(user) {
  return jwt.sign({ id: user.id, name: user.name, scope: SCOPE }, JWT_SECRET, { expiresIn: '8h' });
}

function requirePlatform(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Not signed in' });
  try {
    const decoded = jwt.verify(header.slice(7), JWT_SECRET);
    if (decoded.scope !== SCOPE) return res.status(403).json({ error: 'Not a platform session' });
    req.operator = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Not signed in' });
  }
}

const slugify = s => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

async function uniqueSlug(pool, base) {
  const root = base || 'workspace';
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const { rows } = await pool.query('SELECT slug_in_use($1) AS taken', [candidate]);
    if (!rows[0].taken) return candidate;
  }
  return `${root}-${uuidv4().slice(0, 6)}`;
}

// ---------------------------------------------------------------------------
router.post('/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const { rows } = await getPool().query('SELECT * FROM find_platform_login($1)', [email]);
    const found = rows[0];

    // Compared against a dummy hash when unknown, so a missing operator and a
    // wrong password take the same time to reject.
    const hash = found ? found.password_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    if (!found || !bcrypt.compareSync(password, hash) || found.is_active === false) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json({ operator: { id: found.user_id, name: found.name }, token: signPlatformToken({ id: found.user_id, name: found.name }) });
  } catch (err) {
    console.error('platform login:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', requirePlatform, (req, res) => {
  res.json({ id: req.operator.id, name: req.operator.name });
});

router.get('/requests', requirePlatform, async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    const pool = getPool();
    const [list, counts] = await Promise.all([
      pool.query('SELECT * FROM list_trial_requests($1, $2)', [status, 200]),
      pool.query('SELECT * FROM trial_request_counts()'),
    ]);
    res.json({ requests: list.rows, counts: counts.rows[0] });
  } catch (err) {
    console.error('platform requests:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/requests/:id/approve', requirePlatform, async (req, res) => {
  try {
    const pool = getPool();
    // Listed without a status filter on purpose. Looking only at pending ones
    // makes an already-decided request indistinguishable from a request that
    // never existed, and the two deserve different answers: one is a stale tab,
    // the other is a bad id.
    const { rows } = await pool.query('SELECT * FROM list_trial_requests($1, $2)', [null, 500]);
    const request = rows.find(r => r.id === req.params.id);
    if (!request) return res.status(404).json({ error: 'No request with that id' });
    if (request.status !== 'pending') {
      return res.status(409).json({ error: `That request has already been ${request.status}.` });
    }

    const tenantId = 'tnt_' + uuidv4();
    const slug = await uniqueSlug(pool, slugify(request.workspace_name));
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86400_000).toISOString();

    await pool.query('SELECT approve_trial_request($1,$2,$3,$4,$5,$6)',
      [req.params.id, req.operator.id, tenantId, slug, 'usr_' + uuidv4(), trialEndsAt]);

    res.json({ status: 'approved', tenant_id: tenantId, slug, trial_ends_at: trialEndsAt });
  } catch (err) {
    // The function raises when a request has already been decided, which is a
    // conflict rather than a server fault - two operators looking at the same
    // queue is ordinary.
    if (/already/.test(err.message || '')) return res.status(409).json({ error: err.message });
    console.error('approve:', err);
    res.status(500).json({ error: 'Could not approve the request' });
  }
});

router.post('/requests/:id/reject', requirePlatform, async (req, res) => {
  try {
    const reason = String(req.body.reason || '').trim() || null;
    const { rows } = await getPool().query('SELECT reject_trial_request($1,$2,$3) AS ok',
      [req.params.id, req.operator.id, reason]);
    if (!rows[0].ok) return res.status(409).json({ error: 'That request is no longer pending' });
    res.json({ status: 'rejected' });
  } catch (err) {
    console.error('reject:', err);
    res.status(500).json({ error: 'Could not reject the request' });
  }
});

module.exports = router;
