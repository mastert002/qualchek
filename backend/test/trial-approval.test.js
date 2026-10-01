// Request a trial, have an operator decide on it, then sign in.
//
// The part worth proving is that the request is inert until somebody approves
// it: no workspace, no account, no way in. And that a tenant token cannot open
// the operator console, which is the obvious way this design gets undone.
//
//   node test/trial-approval.test.js        (server must be running on 3001)

require('dotenv').config();
const { Client } = require('pg');
const { v4: uuid } = require('uuid');
const jwt = require('jsonwebtoken');
const http = require('http');

let pass = 0, fail = 0;
const check = (ok, msg) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

function api(method, path, { token, body } = {}) {
  return new Promise(res => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ hostname: 'localhost', port: 3001, path, method,
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
                 ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } },
      rr => { let d = ''; rr.on('data', c => d += c);
        rr.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} res({ code: rr.statusCode, j, raw: d }); }); });
    r.on('error', e => res({ code: 0, raw: e.message }));
    if (data) r.write(data);
    r.end();
  });
}

const sslFor = url => (/localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false });
const stamp = uuid().slice(0, 6);
const EMAIL = `applicant-${stamp}@example.test`;
const PASSWORD = 'applicant-password-1';

(async () => {
  const owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL,
                             ssl: sslFor(process.env.MIGRATION_DATABASE_URL) });
  await owner.connect();
  const madeTenants = [];
  try {
    // ---- the plan catalogue is public ------------------------------------
    const plans = await api('GET', '/api/trial-request/plans');
    check(plans.code === 200 && Array.isArray(plans.j) && plans.j.length === 3,
      `the three plans are offered publicly (${plans.code})`);
    const t5 = (plans.j || []).find(p => p.code === 'team5');
    check(t5 && t5.max_users === 5 && t5.price_monthly_cents === 1500,
      'Team of 5 is 5 users at $15/month');

    // ---- anyone can ask ---------------------------------------------------
    const ask = await api('POST', '/api/trial-request', { body: {
      workspace: `Applicant Co ${stamp}`, name: 'Ada Applicant', email: EMAIL,
      phone: '+234 800 000 0000', company_size: '5-10', plan_code: 'team5',
      note: 'Evaluating for our QA team', password: PASSWORD,
    }});
    check(ask.code === 202, `a request is accepted (${ask.code})`);
    check(ask.j && /review/i.test(ask.j.message || ''), 'the reply says it will be reviewed, not that an account exists');

    // ---- nothing exists yet ----------------------------------------------
    const early = await api('POST', '/api/auth/login', { body: { email: EMAIL, password: PASSWORD } });
    check(early.code === 401, `the applicant cannot sign in before approval (${early.code})`);
    const n0 = await owner.query(`SELECT COUNT(*)::int n FROM tenants WHERE name = $1`, [`Applicant Co ${stamp}`]);
    check(n0.rows[0].n === 0, 'no workspace was provisioned by the request alone');

    // ---- a duplicate request is absorbed silently ------------------------
    const again = await api('POST', '/api/trial-request', { body: {
      workspace: 'Second try', name: 'Ada', email: EMAIL, password: PASSWORD,
    }});
    check(again.code === 202, 'applying twice gets the same answer, revealing nothing about the first');
    const dupes = await owner.query(`SELECT COUNT(*)::int n FROM trial_requests WHERE LOWER(email) = $1 AND status='pending'`, [EMAIL]);
    check(dupes.rows[0].n === 1, '...but only one pending request is stored');

    // ---- the console is closed to the public and to tenants ---------------
    check((await api('GET', '/api/platform/requests')).code === 401, 'the console rejects an anonymous caller');
    const tenantish = jwt.sign({ id: 'x', tenant_id: 'y', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '5m' });
    check((await api('GET', '/api/platform/requests', { token: tenantish })).code === 403,
      'a validly-signed TENANT token cannot open the operator console');

    // ---- an operator signs in --------------------------------------------
    const op = await api('POST', '/api/platform/login', { body: { email: 'ops@qualchek.test', password: 'operator-dev-password' } });
    check(op.code === 200 && !!op.j.token, `an operator can sign in (${op.code})`);
    const opToken = op.j && op.j.token;

    const queue = await api('GET', '/api/platform/requests', { token: opToken, });
    const mine = (queue.j?.requests || []).find(r => r.email === EMAIL);
    check(!!mine, 'the request appears in the review queue');
    check(mine && mine.password_hash === undefined, 'the queue never exposes the applicant password hash');
    check(mine && mine.plan_code === 'team5', 'the chosen plan is carried through to the reviewer');

    // ---- approval provisions everything ----------------------------------
    const approve = await api('POST', `/api/platform/requests/${mine.id}/approve`, { token: opToken });
    check(approve.code === 200, `approval succeeds (${approve.code}) ${approve.code !== 200 ? approve.raw.slice(0,80) : ''}`);
    if (approve.j && approve.j.tenant_id) madeTenants.push(approve.j.tenant_id);

    const row = await owner.query(`SELECT name, plan_code, max_users, status, trial_ends_at FROM tenants WHERE id = $1`,
      [approve.j.tenant_id]);
    const t = row.rows[0];
    check(t && t.plan_code === 'team5' && t.max_users === 5, 'the workspace carries the approved plan and its seat cap');
    const days = t && Math.round((new Date(t.trial_ends_at) - Date.now()) / 86400000);
    check(days === 14, `the trial starts at approval and runs 14 days (got ${days})`);

    // ---- and only now can they sign in -----------------------------------
    const login = await api('POST', '/api/auth/login', { body: { email: EMAIL, password: PASSWORD } });
    check(login.code === 200, `the applicant signs in with the password they chose when applying (${login.code})`);
    check(login.j && login.j.user && login.j.user.role === 'admin', 'and is the admin of their own workspace');

    // ---- approving twice is a conflict, not a second workspace ------------
    check((await api('POST', `/api/platform/requests/${mine.id}/approve`, { token: opToken })).code === 409,
      'approving an already-decided request is refused');

    // ---- and when the trial runs out ---------------------------------------
    // Carried over from the signup suite: the instant-signup route is gone, but
    // what happens at expiry is unchanged and still worth holding onto.
    const tok = login.j.token;
    await owner.query(`UPDATE tenants SET trial_ends_at = $1 WHERE id = $2`,
      [new Date(Date.now() - 86400_000).toISOString(), approve.j.tenant_id]);

    check((await api('GET', '/api/projects', { token: tok })).code === 200,
      'after expiry, reading still works - the data stays theirs');
    const writeAfter = await api('POST', '/api/projects', { token: tok, body: { name: 'Refused' } });
    check(writeAfter.code === 402, `after expiry, writing returns 402 Payment Required (${writeAfter.code})`);
    check(writeAfter.j && writeAfter.j.read_only === true,
      'the refusal tells the client it is read-only rather than broken');

  } finally {
    if (madeTenants.length) await owner.query(`DELETE FROM tenants WHERE id = ANY($1)`, [madeTenants]);
    await owner.query(`DELETE FROM trial_requests WHERE LOWER(email) = $1`, [EMAIL]);
    const left = await owner.query('SELECT COUNT(*)::int n FROM tenants');
    console.log(`\n  cleaned up; tenants remaining: ${left.rows[0].n}`);
    await owner.end();
  }
  console.log(fail ? `\n  ${fail} FAILURE(S), ${pass} passed` : `\n  all ${pass} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('  ERROR', e); process.exit(1); });
