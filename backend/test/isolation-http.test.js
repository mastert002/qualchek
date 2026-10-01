// Isolation through the API, not just the tables.
//
// isolation.test.js proves the policies hold on a connection carrying a tenant.
// This proves the server puts the right tenant on that connection: that a real
// request, with a real signed token, reaches its own data and nothing else.
//
// It also checks the case the design is supposed to make impossible by
// construction - a token whose tenant claim has been changed to someone else's.
//
//   node test/isolation-http.test.js        (server must be running on 3001)

require('dotenv').config();
const { Client } = require('pg');
const { v4: uuid } = require('uuid');
const jwt = require('jsonwebtoken');
const http = require('http');

const A = { id: 'htA_' + uuid().slice(0, 8), name: 'Alpha QA', slug: 'alpha-' + uuid().slice(0, 6) };
const B = { id: 'htB_' + uuid().slice(0, 8), name: 'Beta Labs', slug: 'beta-' + uuid().slice(0, 6) };

let pass = 0, fail = 0;
const check = (ok, msg) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

function api(method, path, token) {
  return new Promise(res => {
    const r = http.request({ hostname: 'localhost', port: 3001, path, method,
      headers: token ? { Authorization: 'Bearer ' + token } : {} },
      rr => { let d = ''; rr.on('data', c => d += c);
        rr.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} res({ code: rr.statusCode, j, raw: d }); }); });
    r.on('error', e => res({ code: 0, raw: e.message }));
    r.end();
  });
}

async function seed(owner, t) {
  const ids = { user: 'u_' + uuid().slice(0, 8), project: 'p_' + uuid().slice(0, 8), tc: 'c_' + uuid().slice(0, 8) };
  await owner.query(`INSERT INTO tenants (id,name,slug,status,plan) VALUES ($1,$2,$3,'trial','trial')`, [t.id, t.name, t.slug]);
  await owner.query(`INSERT INTO users (id,tenant_id,name,email,password_hash,role,is_super_admin)
                     VALUES ($1,$2,$3,$4,'x','admin',TRUE)`, [ids.user, t.id, t.name, `a@${t.slug}.test`]);
  await owner.query(`INSERT INTO projects (id,tenant_id,name,created_by) VALUES ($1,$2,$3,$4)`,
    [ids.project, t.id, t.name + ' Project', ids.user]);
  await owner.query(`INSERT INTO project_members (tenant_id,project_id,user_id,role) VALUES ($1,$2,$3,'admin')`,
    [t.id, ids.project, ids.user]);
  await owner.query(`INSERT INTO test_cases (id,tenant_id,project_id,title,created_by) VALUES ($1,$2,$3,$4,$5)`,
    [ids.tc, t.id, ids.project, `SECRET-${t.name}-case`, ids.user]);
  ids.token = jwt.sign({ id: ids.user, tenant_id: t.id, email: `a@${t.slug}.test`, name: t.name, role: 'admin' },
    process.env.JWT_SECRET, { expiresIn: '10m' });
  return ids;
}

const sslFor = url => (/localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false });

(async () => {
  const owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL,
                             ssl: sslFor(process.env.MIGRATION_DATABASE_URL) });
  await owner.connect();
  try {
    const a = await seed(owner, A);
    const b = await seed(owner, B);
    console.log(`\n  seeded two workspaces, signed a token for each\n`);

    // ---- each sees only its own projects -----------------------------------
    const listA = await api('GET', '/api/projects', a.token);
    check(listA.code === 200, `GET /projects as ${A.name} succeeds (${listA.code})`);
    check(Array.isArray(listA.j) && listA.j.length === 1 && listA.j[0].id === a.project,
      `${A.name} sees exactly its own project, not ${B.name}'s`);

    const listB = await api('GET', '/api/projects', b.token);
    check(Array.isArray(listB.j) && listB.j.length === 1 && listB.j[0].id === b.project,
      `${B.name} sees exactly its own project`);

    // ---- asking for the other tenant's project directly --------------------
    const steal = await api('GET', `/api/projects/${b.project}`, a.token);
    check(steal.code === 404 || steal.code === 403,
      `${A.name} requesting ${B.name}'s project by id is refused (${steal.code})`);

    const stealCases = await api('GET', `/api/projects/${b.project}/test-cases`, a.token);
    const leaked = Array.isArray(stealCases.j) && stealCases.j.some(c => String(c.title).includes(B.name));
    check(!leaked, `${A.name} cannot read ${B.name}'s test cases through their project id (${stealCases.code})`);

    // ---- a token whose tenant claim has been swapped -----------------------
    // Signed with the real secret, so the signature is valid: this is the
    // insider case, not a forgery. The user id belongs to A, the tenant claim
    // says B. The lookup runs inside B, finds no such user, and stops.
    const swapped = jwt.sign({ id: a.user, tenant_id: B.id, email: 'a@x', name: 'x', role: 'admin' },
      process.env.JWT_SECRET, { expiresIn: '5m' });
    const swap = await api('GET', '/api/projects', swapped);
    check(swap.code === 401, `a validly-signed token with someone else's tenant is rejected (${swap.code})`);

    // ---- and the reverse: B's user id with A's tenant ----------------------
    const swapped2 = jwt.sign({ id: b.user, tenant_id: A.id, email: 'b@x', name: 'x', role: 'admin' },
      process.env.JWT_SECRET, { expiresIn: '5m' });
    check((await api('GET', '/api/projects', swapped2)).code === 401,
      `the same swap in the other direction is rejected too`);

    // ---- a token with no tenant at all (a pre-tenancy token) ---------------
    const legacy = jwt.sign({ id: a.user, email: 'a@x', name: 'x', role: 'admin' },
      process.env.JWT_SECRET, { expiresIn: '5m' });
    check((await api('GET', '/api/projects', legacy)).code === 401,
      `a token predating workspaces is rejected rather than defaulting to one`);

  } finally {
    await owner.query(`DELETE FROM tenants WHERE id = ANY($1)`, [[A.id, B.id]]);
    const left = await owner.query(`SELECT COUNT(*)::int n FROM tenants`);
    console.log(`\n  cleaned up; tenants remaining: ${left.rows[0].n}`);
    await owner.end();
  }
  console.log(fail ? `\n  ${fail} FAILURE(S), ${pass} passed` : `\n  all ${pass} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('  ERROR', e); process.exit(1); });
