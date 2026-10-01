// Asking for a trial.
//
// This does NOT create a workspace. It records a request, which a QualChek
// operator then approves or declines from the platform console. That decision
// point is the whole point: a stranger filling in a form should not be able to
// provision tenant infrastructure.
//
// The password is taken now and hashed immediately, so approval produces a
// working account with the password the applicant already chose - no invite
// email, no second decision for them to make days later when they have
// forgotten applying.

const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getPool } = require('../db/database');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

// What the request form offers. Public, because the form has to render it.
router.get('/plans', async (_req, res) => {
  try {
    const { rows } = await getPool().query(
      `SELECT code, name, max_users, price_monthly_cents, currency
         FROM plans WHERE is_active = TRUE ORDER BY sort_order`);
    res.json(rows);
  } catch (err) {
    console.error('plans:', err);
    res.status(500).json({ error: 'Could not load plans' });
  }
});

// POST /api/trial-request
router.post('/', async (req, res) => {
  try {
    const workspace = String(req.body.workspace || '').trim();
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').trim() || null;
    const companySize = String(req.body.company_size || '').trim() || null;
    const planCode = String(req.body.plan_code || '').trim() || null;
    const note = String(req.body.note || '').trim() || null;
    const password = String(req.body.password || '');

    if (!workspace) return res.status(400).json({ error: 'Company or team name is required' });
    if (!name) return res.status(400).json({ error: 'Your name is required' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (password.length < MIN_PASSWORD) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters` });
    }

    const pool = getPool();

    if (planCode) {
      const { rows } = await pool.query('SELECT 1 FROM plans WHERE code = $1 AND is_active = TRUE', [planCode]);
      if (rows.length === 0) return res.status(400).json({ error: 'Choose one of the listed plans' });
    }

    // An address that already has a workspace should sign in, not apply again.
    const { rows: used } = await pool.query('SELECT email_in_use($1) AS taken', [email]);
    if (used[0] && used[0].taken) {
      return res.status(409).json({
        error: 'An account already exists for that email address. Sign in instead.',
      });
    }

    const id = 'req_' + uuidv4();
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || null;

    const { rows: out } = await pool.query(
      'SELECT submit_trial_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS id',
      [id, workspace, name, email, phone, companySize, planCode, note,
       bcrypt.hashSync(password, 10), ip]
    );

    // Null means an address already has a request waiting. Answered the same
    // way as a fresh submission on purpose: telling a stranger that an address
    // has already applied here says something about somebody else.
    const accepted = !!(out[0] && out[0].id);
    if (!accepted) console.log(`trial request: duplicate pending submission for ${email}`);

    return res.status(202).json({
      status: 'received',
      message: 'Your request has been received. We will email you once it is reviewed.',
    });
  } catch (err) {
    console.error('trial request:', err);
    return res.status(500).json({ error: 'Could not submit your request' });
  }
});

module.exports = router;
