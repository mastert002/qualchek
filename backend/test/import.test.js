// Importing test cases from a spreadsheet.
//
// Two halves: the parsing, which is about what a person actually types into a
// cell, and the endpoint, which is about not letting one bad row ruin a good
// file - or one workspace import into another's project.
//
//   node test/import.test.js        (server must be running on 3001)

require('dotenv').config();
const { Client } = require('pg');
const { v4: uuid } = require('uuid');
const jwt = require('jsonwebtoken');
const http = require('http');
const { normaliseRows, parseSteps, parseTags } = require('../src/lib/importCases');

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

(async () => {
  // ---- parsing, no server needed ------------------------------------------
  console.log('\n  parsing\n');

  const numbered = parseSteps('1. Open the login page\n2. Enter credentials\n3. Click Sign in');
  check(numbered.length === 3 && numbered[0].action === 'Open the login page',
    'a numbered list becomes one step per line, without the numbers');

  const bulleted = parseSteps('- First thing\n* Second thing\n• Third thing');
  check(bulleted.length === 3 && bulleted[2].action === 'Third thing',
    'dashes, asterisks and bullets are all stripped');

  const withExpected = parseSteps('Click Export -> A file downloads\nOpen it => It has 3 rows');
  check(withExpected[0].expected === 'A file downloads' && withExpected[1].expected === 'It has 3 rows',
    'an arrow separates the action from what should happen');

  const paragraph = parseSteps('Sign in, go to reports, and export the summary.');
  check(paragraph.length === 1,
    'an unnumbered sentence stays one step rather than being guessed apart');

  check(parseSteps('').length === 0, 'an empty cell gives no steps');
  check(parseTags('smoke, regression ; login|auth').length === 4, 'tags split on commas, semicolons and pipes');

  const { accepted, rejected } = normaliseRows([
    { title: 'Good row', priority: 'HIGH' },
    { title: '', description: 'no title' },
    { title: 'Odd priority', priority: 'urgent' },
  ]);
  check(accepted.length === 2 && rejected.length === 1, 'a row with no title is rejected, the others accepted');
  check(rejected[0].row === 3, `the rejected row number matches the spreadsheet (got ${rejected[0].row})`);
  check(accepted[0].priority === 'high', 'priority is matched case-insensitively');
  check(accepted[1].priority === 'medium', 'an unrecognised priority falls back to medium rather than failing');

  // ---- the endpoint -------------------------------------------------------
  console.log('\n  endpoint\n');
  const owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL,
                             ssl: sslFor(process.env.MIGRATION_DATABASE_URL) });
  await owner.connect();
  const made = [];
  try {
    const mk = async label => {
      const t = { tenant: `imp_${label}_${uuid().slice(0, 8)}`, user: 'u_' + uuid().slice(0, 8), project: 'p_' + uuid().slice(0, 8) };
      await owner.query(`INSERT INTO tenants (id,name,slug,status,plan,plan_code,max_users,trial_ends_at)
                         VALUES ($1,$2,$3,'trial','team5','team5',5,$4)`,
        [t.tenant, `Imp ${label} ${stamp}`, `imp-${label}-${stamp}`, new Date(Date.now() + 7 * 864e5).toISOString()]);
      await owner.query(`INSERT INTO users (id,tenant_id,name,email,password_hash,role,is_super_admin)
                         VALUES ($1,$2,'Imp',$3,'x','admin',TRUE)`,
        [t.user, t.tenant, `imp-${label}-${stamp}@example.test`]);
      await owner.query(`INSERT INTO projects (id,tenant_id,name,created_by) VALUES ($1,$2,$3,$4)`,
        [t.project, t.tenant, `${label} project`, t.user]);
      t.token = jwt.sign({ id: t.user, tenant_id: t.tenant, email: 'x@y.z', name: 'Imp', role: 'admin' },
        process.env.JWT_SECRET, { expiresIn: '10m' });
      return t;
    };
    const A = await mk('alpha'); made.push(A.tenant);
    const B = await mk('beta'); made.push(B.tenant);

    const sheet = [
      { title: `Login works ${stamp}`, priority: 'high', steps: '1. Open /login\n2. Sign in -> Dashboard appears',
        expected_result: 'User reaches the dashboard', tags: 'smoke, auth' },
      { title: `Search returns results ${stamp}`, priority: 'medium', steps: 'Type a query\nPress enter' },
      { title: '', description: 'this row has no title' },
      { title: `Export works ${stamp}`, priority: 'nonsense' },
    ];

    const imp = await api('POST', `/api/projects/${A.project}/test-cases/import`,
      { token: A.token, body: { cases: sheet } });
    check(imp.code === 200, `the import succeeds (${imp.code}) ${imp.code !== 200 ? imp.raw.slice(0, 90) : ''}`);
    check(imp.j && imp.j.created === 3, `three good rows are created (${imp.j && imp.j.created})`);
    check(imp.j && imp.j.failed === 1, `the titleless row is reported, not silently dropped (${imp.j && imp.j.failed})`);
    check(imp.j && imp.j.errors && imp.j.errors[0].row === 4,
      `and names the spreadsheet row (${imp.j && imp.j.errors && imp.j.errors[0].row})`);

    const listed = await api('GET', `/api/projects/${A.project}/test-cases`, { token: A.token });
    const one = (listed.j || []).find(c => c.title === `Login works ${stamp}`);
    check(!!one, 'the imported case is visible in the project');
    check(one && Array.isArray(one.steps) && one.steps.length === 2, `steps were parsed into a list (${one && one.steps && one.steps.length})`);
    check(one && one.steps[1].expected === 'Dashboard appears', 'the arrow became an expected result');
    check(one && one.priority === 'high', 'priority carried through');

    // ---- importing the same file again ------------------------------------
    const again = await api('POST', `/api/projects/${A.project}/test-cases/import`,
      { token: A.token, body: { cases: sheet } });
    check(again.j && again.j.created === 0 && again.j.skipped === 3,
      `re-importing the same sheet creates nothing and skips 3 (created ${again.j && again.j.created}, skipped ${again.j && again.j.skipped})`);

    // ---- one workspace cannot import into another's project ---------------
    const cross = await api('POST', `/api/projects/${B.project}/test-cases/import`,
      { token: A.token, body: { cases: [{ title: `Intrusion ${stamp}` }] } });
    const landed = await owner.query(
      `SELECT COUNT(*)::int n FROM test_cases WHERE project_id = $1`, [B.project]);
    check(landed.rows[0].n === 0,
      `alpha importing into beta's project writes nothing (${cross.code}, beta has ${landed.rows[0].n} cases)`);

    // ---- an empty file -----------------------------------------------------
    check((await api('POST', `/api/projects/${A.project}/test-cases/import`,
      { token: A.token, body: { cases: [] } })).code === 400, 'an empty file is refused with a message');

  } finally {
    if (made.length) await owner.query(`DELETE FROM tenants WHERE id = ANY($1)`, [made]);
    console.log(`\n  cleaned up; tenants remaining: ${(await owner.query('SELECT COUNT(*)::int n FROM tenants')).rows[0].n}`);
    await owner.end();
  }
  console.log(fail ? `\n  ${fail} FAILURE(S), ${pass} passed` : `\n  all ${pass} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('  ERROR', e); process.exit(1); });
