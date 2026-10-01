// The CI path: a pipeline reporting results back into QualChek.
//
// Drives it exactly as a build would - API key only, no browser session - and
// checks the three things that matter: that it works at all under row-level
// security, that one workspace's key cannot reach another's data, and that a
// run reconciles into pass/fail/skipped the way a report expects.
//
//   node test/ci.test.js        (server must be running on 3001)

require('dotenv').config();
const { Client } = require('pg');
const { v4: uuid } = require('uuid');
const http = require('http');

let pass = 0, fail = 0;
const check = (ok, msg) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

function api(method, path, { key, body } = {}) {
  return new Promise(res => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ hostname: 'localhost', port: 3001, path, method,
      headers: { ...(key ? { 'X-API-Key': key } : {}),
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

async function seedWorkspace(owner, label) {
  const ids = {
    tenant: `ci_${label}_${uuid().slice(0, 8)}`,
    user: 'u_' + uuid().slice(0, 8),
    project: 'p_' + uuid().slice(0, 8),
    key: 'key_' + uuid(),
  };
  await owner.query(`INSERT INTO tenants (id,name,slug,status,plan,plan_code,max_users,trial_ends_at)
                     VALUES ($1,$2,$3,'trial','team5','team5',5,$4)`,
    [ids.tenant, `CI ${label} ${stamp}`, `ci-${label}-${stamp}`,
     new Date(Date.now() + 7 * 86400000).toISOString()]);
  await owner.query(`INSERT INTO users (id,tenant_id,name,email,password_hash,role,api_key,is_super_admin)
                     VALUES ($1,$2,'CI Bot',$3,'x','admin',$4,TRUE)`,
    [ids.user, ids.tenant, `ci-${label}-${stamp}@example.test`, ids.key]);
  await owner.query(`INSERT INTO projects (id,tenant_id,name,created_by) VALUES ($1,$2,$3,$4)`,
    [ids.project, ids.tenant, `${label} project`, ids.user]);
  for (const title of ['Login with valid credentials', 'Search returns results', 'Export generates a file']) {
    await owner.query(`INSERT INTO test_cases (id,tenant_id,project_id,title,created_by)
                       VALUES ($1,$2,$3,$4,$5)`,
      ['tc_' + uuid().slice(0, 8), ids.tenant, ids.project, `${title} [${label}]`, ids.user]);
  }
  return ids;
}

(async () => {
  const owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL,
                             ssl: sslFor(process.env.MIGRATION_DATABASE_URL) });
  await owner.connect();
  const made = [];
  try {
    const A = await seedWorkspace(owner, 'alpha'); made.push(A.tenant);
    const B = await seedWorkspace(owner, 'beta'); made.push(B.tenant);
    console.log(`\n  two workspaces, each with an API key and three test cases\n`);

    // ---- it works at all --------------------------------------------------
    check((await api('GET', `/api/ci/projects/${A.project}/cases`)).code === 401,
      'a call with no key is rejected');
    check((await api('GET', `/api/ci/projects/${A.project}/cases`, { key: 'not-a-real-key' })).code === 401,
      'a call with a bogus key is rejected');

    const cases = await api('GET', `/api/ci/projects/${A.project}/cases`, { key: A.key });
    check(cases.code === 200, `a valid key lists test cases (${cases.code})`);
    check(Array.isArray(cases.j) && cases.j.length === 3,
      `and sees its own three cases (saw ${Array.isArray(cases.j) ? cases.j.length : '?'})`);

    // ---- one workspace's key cannot reach another's ------------------------
    const crossList = await api('GET', `/api/ci/projects/${B.project}/cases`, { key: A.key });
    const leaked = Array.isArray(crossList.j) && crossList.j.some(c => /beta/.test(c.title));
    check(!leaked, `alpha's key cannot list beta's test cases (${crossList.code})`);

    const crossRun = await api('POST', `/api/ci/projects/${B.project}/runs`, {
      key: A.key, body: { name: 'intrusion' } });
    check(crossRun.code >= 400,
      `alpha's key cannot start a run in beta's project (${crossRun.code})`);

    // ---- a full pipeline cycle -------------------------------------------
    const run = await api('POST', `/api/ci/projects/${A.project}/runs`, {
      key: A.key, body: { name: `Build ${stamp}`, build_version: '1.4.2', environment: 'staging' } });
    check(run.code === 201 || run.code === 200, `a run is created (${run.code})`);
    const runId = run.j && (run.j.id || run.j.run_id);
    check(!!runId, 'the run has an id the pipeline can report against');

    // Results by title, which is how a framework reports - it knows test names,
    // not QualChek ids.
    const results = await api('POST', `/api/ci/runs/${runId}/results`, {
      key: A.key,
      body: { results: [
        { title: 'Login with valid credentials [alpha]', status: 'passed', duration: 1200 },
        { title: 'Search returns results [alpha]', status: 'failed', notes: 'Timed out waiting for results table' },
      ] } });
    check(results.code === 200, `results are accepted by title (${results.code})`);

    const done = await api('POST', `/api/ci/runs/${runId}/complete`, { key: A.key });
    check(done.code === 200, `the run completes (${done.code})`);

    // The endpoint returns counts rather than the items themselves - which is
    // what a pipeline wants, since it already knows what it sent. Postgres
    // SUM() comes back as a string, hence Number().
    const summary = await api('GET', `/api/ci/runs/${runId}`, { key: A.key });
    const n = k => Number(summary.j && summary.j[k]);
    check(n('passed') === 1, `one case passed (${n('passed')})`);
    check(n('failed') === 1, `one case failed (${n('failed')})`);
    check(n('skipped') === 1,
      `the case CI never reported is recorded as skipped rather than silently missing (${n('skipped')})`);
    check(n('total') === 3, `the run covers all three cases in the project (${n('total')})`);
    check(summary.j && summary.j.status === 'completed',
      `the run is marked completed (${summary.j && summary.j.status})`);

    // ---- a lapsed trial stops a pipeline writing --------------------------
    await owner.query(`UPDATE tenants SET trial_ends_at = $1 WHERE id = $2`,
      [new Date(Date.now() - 86400000).toISOString(), A.tenant]);
    check((await api('GET', `/api/ci/projects/${A.project}/cases`, { key: A.key })).code === 200,
      'after the trial lapses a pipeline can still read');
    const blocked = await api('POST', `/api/ci/projects/${A.project}/runs`, {
      key: A.key, body: { name: 'after expiry' } });
    check(blocked.code === 402,
      `...but reporting a new run returns 402 rather than appearing to succeed (${blocked.code})`);

  } finally {
    if (made.length) await owner.query(`DELETE FROM tenants WHERE id = ANY($1)`, [made]);
    console.log(`\n  cleaned up; tenants remaining: ${(await owner.query('SELECT COUNT(*)::int n FROM tenants')).rows[0].n}`);
    await owner.end();
  }
  console.log(fail ? `\n  ${fail} FAILURE(S), ${pass} passed` : `\n  all ${pass} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('  ERROR', e); process.exit(1); });
