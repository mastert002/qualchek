// Does tenant isolation actually hold?
//
// Not "is tenant_id on every table" - that is just a column. The question is
// whether a connection carrying tenant A's context can reach tenant B's rows
// through any table, by any query, including ones that deliberately ask for
// them by primary key.
//
// Two tenants are built through the OWNER connection, which bypasses the
// policies, so the fixtures land regardless of context. Every assertion is then
// made through the APPLICATION connection, which is the one the server uses.
//
//   node test/isolation.test.js

require('dotenv').config();
const { Client, Pool } = require('pg');
const { v4: uuid } = require('uuid');
const { withTenant } = require('../src/db/tenantContext');

const A = { id: 'tnt_a_' + uuid().slice(0, 8), name: 'Alpha QA', slug: 'alpha-' + uuid().slice(0, 6) };
const B = { id: 'tnt_b_' + uuid().slice(0, 8), name: 'Beta Labs', slug: 'beta-' + uuid().slice(0, 6) };

let pass = 0, fail = 0;
const check = (ok, msg) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

const sslFor = url => (/localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false });

async function seed(owner, t) {
  const ids = {
    user: 'usr_' + uuid().slice(0, 8),
    project: 'prj_' + uuid().slice(0, 8),
    suite: 'ste_' + uuid().slice(0, 8),
    testCase: 'tc_' + uuid().slice(0, 8),
    run: 'run_' + uuid().slice(0, 8),
    cred: 'crd_' + uuid().slice(0, 8),
  };
  await owner.query(`INSERT INTO tenants (id, name, slug, status, plan) VALUES ($1,$2,$3,'trial','trial')`,
    [t.id, t.name, t.slug]);
  await owner.query(`INSERT INTO users (id, tenant_id, name, email, password_hash, role, is_super_admin)
                     VALUES ($1,$2,$3,$4,'x','admin',TRUE)`,
    [ids.user, t.id, t.name + ' Admin', `admin@${t.slug}.test`]);
  await owner.query(`INSERT INTO projects (id, tenant_id, name, created_by) VALUES ($1,$2,$3,$4)`,
    [ids.project, t.id, t.name + ' Project', ids.user]);
  await owner.query(`INSERT INTO test_suites (id, tenant_id, project_id, name) VALUES ($1,$2,$3,$4)`,
    [ids.suite, t.id, ids.project, t.name + ' Suite']);
  await owner.query(`INSERT INTO test_cases (id, tenant_id, project_id, suite_id, title, created_by)
                     VALUES ($1,$2,$3,$4,$5,$6)`,
    [ids.testCase, t.id, ids.project, ids.suite, `SECRET-${t.name}-case`, ids.user]);
  await owner.query(`INSERT INTO test_runs (id, tenant_id, project_id, name, created_by) VALUES ($1,$2,$3,$4,$5)`,
    [ids.run, t.id, ids.project, t.name + ' Run', ids.user]);
  await owner.query(`INSERT INTO crawler_credentials (id, tenant_id, project_id, label, url_pattern, username, password)
                     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [ids.cred, t.id, ids.project, t.name + ' cred', `https://${t.slug}.test`, 'crawler', 'SECRET-PASSWORD-' + t.slug]);
  await owner.query(`INSERT INTO jira_config (tenant_id, base_url, email, api_token)
                     VALUES ($1,$2,$3,$4)`,
    [t.id, `https://${t.slug}.atlassian.net`, 'a@b.c', 'SECRET-TOKEN-' + t.slug]);
  return ids;
}

(async () => {
  const owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL,
                             ssl: sslFor(process.env.MIGRATION_DATABASE_URL) });
  await owner.connect();
  const appPool = new Pool({ connectionString: process.env.DATABASE_URL,
                             ssl: sslFor(process.env.DATABASE_URL), max: 5 });

  try {
    const idsA = await seed(owner, A);
    const idsB = await seed(owner, B);
    console.log(`\n  seeded ${A.name} and ${B.name}\n`);

    // ---- 1. ordinary reads see only your own ------------------------------
    await withTenant(appPool, A.id, async () => {
      const { currentClient } = require('../src/db/tenantContext');
      const c = currentClient();
      for (const table of ['projects', 'test_cases', 'test_runs', 'test_suites',
                           'crawler_credentials', 'users', 'jira_config', 'tenants']) {
        const { rows } = await c.query(`SELECT COUNT(*)::int n FROM ${table}`);
        check(rows[0].n === 1, `as ${A.name}: ${table} shows 1 row, not both tenants' (saw ${rows[0].n})`);
      }
    });

    // ---- 2. asking for the other tenant's row BY ID ------------------------
    await withTenant(appPool, A.id, async () => {
      const { currentClient } = require('../src/db/tenantContext');
      const c = currentClient();
      const probes = [
        ['projects', idsB.project], ['test_cases', idsB.testCase],
        ['test_runs', idsB.run], ['crawler_credentials', idsB.cred],
        ['users', idsB.user], ['test_suites', idsB.suite],
      ];
      for (const [table, id] of probes) {
        const { rows } = await c.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
        check(rows.length === 0, `as ${A.name}: SELECT ${table} by ${B.name}'s primary key returns nothing`);
      }
      const { rows: jc } = await c.query(`SELECT * FROM jira_config WHERE tenant_id = $1`, [B.id]);
      check(jc.length === 0, `as ${A.name}: ${B.name}'s Jira token is unreachable`);
    });

    // ---- 3. the secrets themselves never appear ---------------------------
    await withTenant(appPool, A.id, async () => {
      const { currentClient } = require('../src/db/tenantContext');
      const c = currentClient();
      const { rows: creds } = await c.query(`SELECT password FROM crawler_credentials`);
      check(!creds.some(r => String(r.password).includes(B.slug)),
        `as ${A.name}: no crawler password belonging to ${B.name} is visible`);
      const { rows: cases } = await c.query(`SELECT title FROM test_cases`);
      check(!cases.some(r => r.title.includes(B.name)),
        `as ${A.name}: no test case belonging to ${B.name} is visible`);
    });

    // ---- 4. writing into someone else's tenant is refused ------------------
    await withTenant(appPool, A.id, async () => {
      const { currentClient } = require('../src/db/tenantContext');
      const c = currentClient();
      let blocked = false;
      try {
        await c.query(`INSERT INTO projects (id, tenant_id, name, created_by) VALUES ($1,$2,'intrusion',$3)`,
          ['prj_evil_' + uuid().slice(0, 6), B.id, idsA.user]);
      } catch { blocked = true; }
      check(blocked, `as ${A.name}: INSERT into ${B.name}'s tenant is rejected by WITH CHECK`);

      const upd = await c.query(`UPDATE test_cases SET title = 'tampered' WHERE id = $1`, [idsB.testCase]);
      check(upd.rowCount === 0, `as ${A.name}: UPDATE of ${B.name}'s test case affects 0 rows`);

      const del = await c.query(`DELETE FROM projects WHERE id = $1`, [idsB.project]);
      check(del.rowCount === 0, `as ${A.name}: DELETE of ${B.name}'s project affects 0 rows`);
    });

    // ---- 5. no context at all sees nothing --------------------------------
    await withTenant(appPool, null, async () => {
      const { currentClient } = require('../src/db/tenantContext');
      const c = currentClient();
      const { rows } = await c.query(`SELECT COUNT(*)::int n FROM test_cases`);
      check(rows[0].n === 0, `with no tenant context: test_cases returns nothing, not everything`);
    });

    // ---- 6. context does not leak between sequential checkouts -------------
    await withTenant(appPool, B.id, async () => {
      const { currentClient } = require('../src/db/tenantContext');
      const { rows } = await currentClient().query(`SELECT name FROM tenants`);
      check(rows.length === 1 && rows[0].name === B.name,
        `switching to ${B.name} shows ${B.name} only, with no trace of the previous context`);
    });

  } finally {
    // Remove both tenants; cascades clear everything beneath them.
    await owner.query(`DELETE FROM tenants WHERE id = ANY($1)`, [[A.id, B.id]]);
    const left = await owner.query(`SELECT COUNT(*)::int n FROM test_cases`);
    console.log(`\n  cleaned up; test_cases remaining: ${left.rows[0].n}`);
    await owner.end();
    await appPool.end();
  }

  console.log(fail ? `\n  ${fail} FAILURE(S), ${pass} passed` : `\n  all ${pass} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('  ERROR', e); process.exit(1); });
