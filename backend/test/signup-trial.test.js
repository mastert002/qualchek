// Signup, and what happens when the trial runs out.
//
// The expiry case is the one worth testing properly: it is easy to write a
// check that never fires, and nobody notices until a trial ends in front of a
// customer. Here the trial is aged by moving trial_ends_at into the past, which
// is what the middleware actually reads.
//
//   node test/signup-trial.test.js        (server must be running on 3001)

require('dotenv').config();
const { Client } = require('pg');
const { v4: uuid } = require('uuid');
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
const created = [];

(async () => {
  const owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL,
                             ssl: sslFor(process.env.MIGRATION_DATABASE_URL) });
  await owner.connect();
  try {
    // ---- signing up ------------------------------------------------------
    const signup = await api('POST', '/api/signup', { body: {
      workspace: `Acme QA ${stamp}`, name: 'Ada Lovelace',
      email: `ada-${stamp}@example.test`, password: 'correct-horse-battery',
    }});
    check(signup.code === 201, `signup returns 201 (${signup.code}) ${signup.code !== 201 ? signup.raw.slice(0, 90) : ''}`);
    const token = signup.j && signup.j.token;
    const tenant = signup.j && signup.j.tenant;
    if (tenant) created.push(tenant.id);

    check(!!token, 'signup returns an access token - no email round-trip before you can look');
    check(tenant && tenant.status === 'trial' && tenant.plan === 'trial', 'the workspace starts on a trial');
    check(tenant && /^acme-qa-/.test(tenant.slug), `a slug is derived from the workspace name (${tenant && tenant.slug})`);

    const days = tenant && Math.round((new Date(tenant.trial_ends_at) - Date.now()) / 86400_000);
    check(days === 14, `the trial runs 14 days (got ${days})`);

    check(signup.j && signup.j.user && signup.j.user.role === 'admin',
      'the first account is an admin of its own workspace');

    // ---- the new workspace works -----------------------------------------
    const me = await api('GET', '/api/auth/me', { token });
    check(me.code === 200, `the token works immediately (${me.code})`);

    const mkProject = await api('POST', '/api/projects', { token, body: { name: 'First project' } });
    check(mkProject.code === 201 || mkProject.code === 200, `can create a project during the trial (${mkProject.code})`);

    // ---- the same address cannot sign up twice ---------------------------
    const dupe = await api('POST', '/api/signup', { body: {
      workspace: 'Another', name: 'Ada', email: `ada-${stamp}@example.test`, password: 'correct-horse-battery',
    }});
    check(dupe.code === 409, `a second signup with the same address is refused (${dupe.code})`);

    // ---- two workspaces may share a name ---------------------------------
    const twin = await api('POST', '/api/signup', { body: {
      workspace: `Acme QA ${stamp}`, name: 'Grace Hopper',
      email: `grace-${stamp}@example.test`, password: 'correct-horse-battery',
    }});
    if (twin.j && twin.j.tenant) created.push(twin.j.tenant.id);
    check(twin.code === 201, `a second workspace with the same name is allowed (${twin.code})`);
    check(twin.j && twin.j.tenant && twin.j.tenant.slug !== tenant.slug,
      `...and gets its own slug (${twin.j && twin.j.tenant && twin.j.tenant.slug})`);

    // ---- validation -------------------------------------------------------
    for (const [body, what] of [
      [{ workspace: '', name: 'A', email: `x-${stamp}@e.test`, password: 'correct-horse' }, 'a missing workspace name'],
      [{ workspace: 'W', name: 'A', email: 'not-an-email', password: 'correct-horse' }, 'an invalid address'],
      [{ workspace: 'W', name: 'A', email: `y-${stamp}@e.test`, password: 'short' }, 'a password under 8 characters'],
    ]) {
      check((await api('POST', '/api/signup', { body })).code === 400, `signup rejects ${what}`);
    }

    // ---- now age the trial past its end ----------------------------------
    await owner.query(`UPDATE tenants SET trial_ends_at = $1 WHERE id = $2`,
      [new Date(Date.now() - 86400_000).toISOString(), tenant.id]);

    const readAfter = await api('GET', '/api/projects', { token });
    check(readAfter.code === 200, `after expiry, reading still works - the data stays theirs (${readAfter.code})`);

    const writeAfter = await api('POST', '/api/projects', { token, body: { name: 'Should be refused' } });
    check(writeAfter.code === 402, `after expiry, writing returns 402 Payment Required (${writeAfter.code})`);
    check(writeAfter.j && writeAfter.j.read_only === true,
      'the refusal tells the client it is read-only rather than broken');

    const stillMe = await api('GET', '/api/auth/me', { token });
    check(stillMe.code === 200, 'auth/me keeps working, so the app can still show who you are');

  } finally {
    if (created.length) {
      await owner.query(`DELETE FROM tenants WHERE id = ANY($1)`, [created]);
    }
    const left = await owner.query(`SELECT COUNT(*)::int n FROM tenants`);
    console.log(`\n  cleaned up ${created.length} workspace(s); tenants remaining: ${left.rows[0].n}`);
    await owner.end();
  }
  console.log(fail ? `\n  ${fail} FAILURE(S), ${pass} passed` : `\n  all ${pass} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('  ERROR', e); process.exit(1); });
