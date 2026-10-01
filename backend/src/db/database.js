const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { currentClient } = require('./tenantContext');

// Hosted Postgres (Supabase, RDS) requires TLS; a local server usually is not
// built with it and rejects the attempt outright. Decided from the host rather
// than hardcoded, so the same code runs in both places.
function sslFor(url) {
  try {
    const host = new URL(url).hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
  } catch { /* fall through to the safe default */ }
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslFor(process.env.DATABASE_URL),
  // A request now holds a client for its duration (see tenantContext.js), so
  // a server handling concurrent requests needs more than one. A serverless
  // instance still serves one request at a time, so it keeps the single
  // connection it was tuned for.
  max: Number(process.env.DB_POOL_MAX)
    || ((process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME) ? 1 : 10),
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 25000,
});

let _db = null;

function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function flattenArgs(args) {
  return args.map(a => a === undefined ? null : a);
}

// Supabase goes idle, and a cold serverless instance then times out on its
// first connection. That surfaced to users as a 500 on login: initDb() failed,
// and the very next query hit a pool that had never connected. These failures
// are connection-level and transient - the second attempt normally succeeds
// once the database has woken up - so retry them briefly rather than failing
// the request. Genuine SQL errors do not match and are rethrown immediately.
const TRANSIENT = /Connection terminated|connection timeout|timeout expired|ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|Client has encountered a connection error|terminating connection/i;

const RETRY_DELAYS_MS = [400, 1200];

async function queryWithRetry(pool, sql, args) {
  for (let attempt = 0; ; attempt++) {
    try {
      // Inside a request this MUST be the client whose session carries
      // app.tenant_id; the pool would hand back an arbitrary connection where
      // the tenant is unset and row-level security therefore matches nothing.
      // Outside a request (startup, migrations, background jobs) the pool is
      // correct.
      const target = currentClient() || pool;
      return await target.query(sql, args);
    } catch (err) {
      const transient = TRANSIENT.test(err && err.message ? err.message : '');
      if (!transient || attempt >= RETRY_DELAYS_MS.length) throw err;
      console.warn(`DB: transient failure (${err.message}), retry ${attempt + 1}`);
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
}


/**
 * Confirm the connection the app serves requests on is actually subject to the
 * policies.
 *
 * A table owner, a superuser and any role with BYPASSRLS all ignore row-level
 * security completely. Point DATABASE_URL at one of those and every policy
 * above becomes decorative: the app keeps working, the tests keep passing, and
 * every tenant can read every other tenant. Nothing visible goes wrong, which
 * is what makes it worth refusing to start over.
 */
async function assertIsolationActive(pool) {
  const { rows } = await queryWithRetry(pool, `
    SELECT current_user AS role,
           (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_super,
           (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypasses_rls,
           (SELECT tableowner = current_user FROM pg_tables
             WHERE schemaname = 'public' AND tablename = 'users') AS owns_tables
  `);
  const r = rows[0] || {};
  const reasons = [];
  if (r.is_super) reasons.push('it is a superuser');
  if (r.bypasses_rls) reasons.push('it has BYPASSRLS');
  if (r.owns_tables) reasons.push('it owns the tables');

  if (reasons.length === 0) {
    console.log(`DB: tenant isolation active (connected as ${r.role})`);
    return true;
  }

  const message =
    `Tenant isolation is NOT in effect. The application connects as "${r.role}", which `
    + `ignores row-level security because ${reasons.join(' and ')}. Every tenant can read `
    + `every other tenant's data. Point DATABASE_URL at the non-owning application role `
    + `(see migrations/000-create-database.sql) and keep the owner for migrations only.`;

  // Refusing outright in development would block anyone running a single-role
  // local Postgres, which is a reasonable way to work on everything except
  // isolation. Hosted, there is no acceptable reason to run this way.
  if (process.env.VERCEL === '1' || process.env.NODE_ENV === 'production') {
    throw new Error(message);
  }
  console.warn('\n*** WARNING: ' + message + '\n');
  return false;
}

function wrapDb(pool) {
  return {
    prepare(sql) {
      const pgSql = convertPlaceholders(sql);
      return {
        async run(...args) {
          await queryWithRetry(pool, pgSql, flattenArgs(args));
          return { changes: 1 };
        },
        async get(...args) {
          const { rows } = await queryWithRetry(pool, pgSql, flattenArgs(args));
          return rows[0];
        },
        async all(...args) {
          const { rows } = await queryWithRetry(pool, pgSql, flattenArgs(args));
          return rows;
        },
      };
    },
    async exec(sql) {
      await queryWithRetry(pool, sql);
    },
    transaction(fn) {
      return async (...args) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await fn(...args);
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      };
    },
    pragma() {}, // no-op for PostgreSQL
  };
}

function getDb() {
  return _db;
}

// The raw pool, for the few places that need a connection rather than a query:
// tenantContext checks one out per request so the session variable it sets
// applies to every query that request makes.
function getPool() {
  return pool;
}

async function initDb() {
  _db = wrapDb(pool);

  // DDL runs as the owner. The pool above belongs to the application role,
  // which deliberately cannot create or alter anything - that is what makes it
  // subject to the policies. Falling back to the same URL keeps a single-role
  // setup working; assertIsolationActive() then says what that costs.
  const ddlUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  const ddl = new Pool({
    connectionString: ddlUrl,
    ssl: sslFor(ddlUrl),
    max: 1,
  });

  // Skip schema creation if tables already exist (faster cold starts on Vercel)
  // Retry here too: this is the first connection a cold instance makes, and it
  // is the query that was timing out against an idle Supabase.
  // table_schema matters: Supabase ships its own auth.users (and
  // auth.refresh_tokens) for GoTrue, which this app does not use. Without the
  // schema filter this check matches auth.users on a brand-new project and
  // skips creating every table the app actually needs.
  const { rows: tableCheck } = await queryWithRetry(ddl, `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users' LIMIT 1`);
  if (tableCheck.length > 0) {
    console.log('DB: tables exist, skipping schema init');
    await assertIsolationActive(pool);
    await ddl.end();
    return _db;
  }

  await ddl.query(`
    -- One customer. Everything else in this schema belongs to exactly one row
    -- here, and row-level security (below) is what keeps them apart.
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      -- Used in URLs and as the human-readable handle. Unique across the
      -- install, unlike almost everything else here.
      slug TEXT UNIQUE NOT NULL,
      -- trial | active | past_due | cancelled | suspended
      status TEXT NOT NULL DEFAULT 'trial',
      plan TEXT NOT NULL DEFAULT 'trial',
      trial_ends_at TEXT,
      -- Set when a plan is bought; null for a trial.
      subscribed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    );

    CREATE TABLE IF NOT EXISTS users (
      -- Defaulted from the same session setting the policies read, so an
      -- INSERT that does not mention tenant_id still lands in the right
      -- tenant - and cannot land in the wrong one. That keeps every
      -- existing INSERT in the route files correct without edits.
      tenant_id TEXT NOT NULL DEFAULT current_setting('app.tenant_id', true)
        REFERENCES tenants(id) ON DELETE CASCADE,
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'tester',
      api_key TEXT,
      -- Deactivated accounts keep all their history but cannot sign in.
      -- NOTE: initDb() returns early when the users table already exists, so an
      -- existing database needs this adding by migration, not from here.
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      -- A flag rather than a role: ~20 checks elsewhere test role === 'admin',
      -- so a separate 'superadmin' role would strip ordinary admin powers.
      -- This layers extra authority (over other admins) on top of role='admin'.
      is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
      UNIQUE (tenant_id, email)
    );

    CREATE TABLE IF NOT EXISTS projects (
      -- Defaulted from the same session setting the policies read, so an
      -- INSERT that does not mention tenant_id still lands in the right
      -- tenant - and cannot land in the wrong one. That keeps every
      -- existing INSERT in the route files correct without edits.
      tenant_id TEXT NOT NULL DEFAULT current_setting('app.tenant_id', true)
        REFERENCES tenants(id) ON DELETE CASCADE,
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    );

    CREATE TABLE IF NOT EXISTS project_members (
      -- Defaulted from the same session setting the policies read, so an
      -- INSERT that does not mention tenant_id still lands in the right
      -- tenant - and cannot land in the wrong one. That keeps every
      -- existing INSERT in the route files correct without edits.
      tenant_id TEXT NOT NULL DEFAULT current_setting('app.tenant_id', true)
        REFERENCES tenants(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'tester',
      PRIMARY KEY (project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS test_suites (
      -- Defaulted from the same session setting the policies read, so an
      -- INSERT that does not mention tenant_id still lands in the right
      -- tenant - and cannot land in the wrong one. That keeps every
      -- existing INSERT in the route files correct without edits.
      tenant_id TEXT NOT NULL DEFAULT current_setting('app.tenant_id', true)
        REFERENCES tenants(id) ON DELETE CASCADE,
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      parent_id TEXT,
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    );

    CREATE TABLE IF NOT EXISTS test_cases (
      -- Defaulted from the same session setting the policies read, so an
      -- INSERT that does not mention tenant_id still lands in the right
      -- tenant - and cannot land in the wrong one. That keeps every
      -- existing INSERT in the route files correct without edits.
      tenant_id TEXT NOT NULL DEFAULT current_setting('app.tenant_id', true)
        REFERENCES tenants(id) ON DELETE CASCADE,
      id TEXT PRIMARY KEY,
      suite_id TEXT,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      preconditions TEXT,
      steps TEXT NOT NULL DEFAULT '[]',
      expected_result TEXT,
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'active',
      tags TEXT NOT NULL DEFAULT '[]',
      automation_status TEXT NOT NULL DEFAULT 'manual',
      automation_framework TEXT,
      script_path TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
      updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    );

    CREATE TABLE IF NOT EXISTS test_runs (
      -- Defaulted from the same session setting the policies read, so an
      -- INSERT that does not mention tenant_id still lands in the right
      -- tenant - and cannot land in the wrong one. That keeps every
      -- existing INSERT in the route files correct without edits.
      tenant_id TEXT NOT NULL DEFAULT current_setting('app.tenant_id', true)
        REFERENCES tenants(id) ON DELETE CASCADE,
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      build_version TEXT,
      environment TEXT,
      parent_run_id TEXT,
      run_source TEXT NOT NULL DEFAULT 'manual',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
      started_at TEXT,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS test_run_items (
      -- Defaulted from the same session setting the policies read, so an
      -- INSERT that does not mention tenant_id still lands in the right
      -- tenant - and cannot land in the wrong one. That keeps every
      -- existing INSERT in the route files correct without edits.
      tenant_id TEXT NOT NULL DEFAULT current_setting('app.tenant_id', true)
        REFERENCES tenants(id) ON DELETE CASCADE,
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      test_case_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      executed_by TEXT,
      executed_at TEXT,
      duration INTEGER
    );

    CREATE TABLE IF NOT EXISTS comments (
      -- Defaulted from the same session setting the policies read, so an
      -- INSERT that does not mention tenant_id still lands in the right
      -- tenant - and cannot land in the wrong one. That keeps every
      -- existing INSERT in the route files correct without edits.
      tenant_id TEXT NOT NULL DEFAULT current_setting('app.tenant_id', true)
        REFERENCES tenants(id) ON DELETE CASCADE,
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    );

    CREATE TABLE IF NOT EXISTS jira_config (
      tenant_id TEXT PRIMARY KEY DEFAULT current_setting('app.tenant_id', true)
        REFERENCES tenants(id) ON DELETE CASCADE,
      base_url TEXT NOT NULL,
      email TEXT NOT NULL,
      api_token TEXT NOT NULL,
      default_project TEXT
    );

    CREATE TABLE IF NOT EXISTS jira_links (
      -- Defaulted from the same session setting the policies read, so an
      -- INSERT that does not mention tenant_id still lands in the right
      -- tenant - and cannot land in the wrong one. That keeps every
      -- existing INSERT in the route files correct without edits.
      tenant_id TEXT NOT NULL DEFAULT current_setting('app.tenant_id', true)
        REFERENCES tenants(id) ON DELETE CASCADE,
      test_case_id TEXT PRIMARY KEY,
      issue_key TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jira_run_links (
      -- Defaulted from the same session setting the policies read, so an
      -- INSERT that does not mention tenant_id still lands in the right
      -- tenant - and cannot land in the wrong one. That keeps every
      -- existing INSERT in the route files correct without edits.
      tenant_id TEXT NOT NULL DEFAULT current_setting('app.tenant_id', true)
        REFERENCES tenants(id) ON DELETE CASCADE,
      run_item_id TEXT PRIMARY KEY,
      issue_key TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      -- Defaulted from the same session setting the policies read, so an
      -- INSERT that does not mention tenant_id still lands in the right
      -- tenant - and cannot land in the wrong one. That keeps every
      -- existing INSERT in the route files correct without edits.
      tenant_id TEXT NOT NULL DEFAULT current_setting('app.tenant_id', true)
        REFERENCES tenants(id) ON DELETE CASCADE,
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      actor_id TEXT,
      actor_name TEXT,
      actor_email TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      target_label TEXT,
      detail TEXT,
      ip TEXT
    );

    CREATE TABLE IF NOT EXISTS crawler_credentials (
      -- Defaulted from the same session setting the policies read, so an
      -- INSERT that does not mention tenant_id still lands in the right
      -- tenant - and cannot land in the wrong one. That keeps every
      -- existing INSERT in the route files correct without edits.
      tenant_id TEXT NOT NULL DEFAULT current_setting('app.tenant_id', true)
        REFERENCES tenants(id) ON DELETE CASCADE,
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      label TEXT NOT NULL,
      url_pattern TEXT NOT NULL,
      login_url TEXT,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      username_field TEXT,
      password_field TEXT,
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
      updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    );

    -- The durable half of a session. Only the SHA-256 of each token is kept,
    -- so a database dump cannot be replayed against the API.
    -- NOTE: initDb() returns early when the users table already exists, so an
    -- existing database needs this adding by migration, not from here.
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      -- Defaulted from the same session setting the policies read, so an
      -- INSERT that does not mention tenant_id still lands in the right
      -- tenant - and cannot land in the wrong one. That keeps every
      -- existing INSERT in the route files correct without edits.
      tenant_id TEXT NOT NULL DEFAULT current_setting('app.tenant_id', true)
        REFERENCES tenants(id) ON DELETE CASCADE,
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      -- Every rotation stays in the same family, so replaying a spent token
      -- can revoke the entire chain it belongs to.
      family_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
    );
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);
  `);


  // Row-level security is the isolation boundary, not the ~164 WHERE clauses
  // scattered through the route files. Each policy compares the row's tenant
  // against app.tenant_id, which tenantContext.js pins to the request's own
  // connection.
  //
  // current_setting(..., true) returns NULL when the setting is absent, and
  // `tenant_id = NULL` is NULL rather than true - so a query made with no
  // tenant set matches no rows. A code path that forgets to establish context
  // therefore returns nothing, which shows up as an obvious bug, instead of
  // returning everything, which shows up as a breach.
  //
  // ENABLE rather than FORCE: the owner must stay exempt so migrations and
  // this function can still write across tenants. That exemption is exactly
  // why the application connects as a different, non-owning role - and why
  // assertIsolationActive() below refuses to let that go unnoticed.
  await ddl.query(`
    ALTER TABLE users ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON users;
    CREATE POLICY tenant_isolation ON users
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
    ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON projects;
    CREATE POLICY tenant_isolation ON projects
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
    ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON project_members;
    CREATE POLICY tenant_isolation ON project_members
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
    ALTER TABLE test_suites ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON test_suites;
    CREATE POLICY tenant_isolation ON test_suites
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
    ALTER TABLE test_cases ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON test_cases;
    CREATE POLICY tenant_isolation ON test_cases
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
    ALTER TABLE test_runs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON test_runs;
    CREATE POLICY tenant_isolation ON test_runs
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
    ALTER TABLE test_run_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON test_run_items;
    CREATE POLICY tenant_isolation ON test_run_items
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
    ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON comments;
    CREATE POLICY tenant_isolation ON comments
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
    ALTER TABLE jira_config ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON jira_config;
    CREATE POLICY tenant_isolation ON jira_config
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
    ALTER TABLE jira_links ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON jira_links;
    CREATE POLICY tenant_isolation ON jira_links
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
    ALTER TABLE jira_run_links ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON jira_run_links;
    CREATE POLICY tenant_isolation ON jira_run_links
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
    ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON audit_log;
    CREATE POLICY tenant_isolation ON audit_log
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
    ALTER TABLE crawler_credentials ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON crawler_credentials;
    CREATE POLICY tenant_isolation ON crawler_credentials
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
    ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON refresh_tokens;
    CREATE POLICY tenant_isolation ON refresh_tokens
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
    ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON tenants;
    CREATE POLICY tenant_isolation ON tenants
      USING (id = current_setting('app.tenant_id', true))
      WITH CHECK (id = current_setting('app.tenant_id', true));
  `);


  // Two operations have to cross the tenant boundary by their nature, and both
  // happen before a tenant is known:
  //
  //   signing in  - the address is typed on a shared login page, so the server
  //                 must find which tenant it belongs to before it can set one
  //   signing up  - creates the tenant, so there is nothing to scope to yet
  //
  // SECURITY DEFINER makes these run as the owner, which is exempt from the
  // policies. That is the controlled exception: a narrow, auditable function
  // instead of handing the whole application a role that ignores RLS. Each
  // returns only what its caller needs, and neither takes a tenant from the
  // caller - they derive it.
  await ddl.query(`
    CREATE OR REPLACE FUNCTION find_login(p_email TEXT)
    RETURNS TABLE (user_id TEXT, tenant_id TEXT, password_hash TEXT,
                   is_active BOOLEAN, tenant_status TEXT)
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $fn$
      SELECT u.id, u.tenant_id, u.password_hash, u.is_active, t.status
      FROM users u
      JOIN tenants t ON t.id = u.tenant_id
      WHERE LOWER(u.email) = LOWER(p_email)
      LIMIT 1;
    $fn$;

    -- Deliberately not granted to PUBLIC.
    REVOKE ALL ON FUNCTION find_login(TEXT) FROM PUBLIC;

    -- Whether an address is already taken, without revealing which tenant it
    -- belongs to. Signup needs this; nothing else should infer tenant
    -- membership from it.
    CREATE OR REPLACE FUNCTION email_in_use(p_email TEXT)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $fn$
      SELECT EXISTS (SELECT 1 FROM users WHERE LOWER(email) = LOWER(p_email));
    $fn$;
    REVOKE ALL ON FUNCTION email_in_use(TEXT) FROM PUBLIC;

    -- A refresh cookie is a random secret, not a token carrying claims, so the
    -- tenant it belongs to can only be discovered by looking it up - and that
    -- lookup necessarily crosses tenants. Returns the tenant and nothing else:
    -- whether the token is valid, spent or expired is decided afterwards,
    -- inside that tenant, by the ordinary policy-scoped query.
    CREATE OR REPLACE FUNCTION find_refresh_tenant(p_token_hash TEXT)
    RETURNS TEXT
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $fn$
      SELECT tenant_id FROM refresh_tokens WHERE token_hash = p_token_hash LIMIT 1;
    $fn$;
    REVOKE ALL ON FUNCTION find_refresh_tenant(TEXT) FROM PUBLIC;

    -- Whether a workspace handle is taken. Crosses tenants by nature: slugs are
    -- unique across the install. Returns only a boolean, so it cannot be used
    -- to enumerate who exists.
    CREATE OR REPLACE FUNCTION slug_in_use(p_slug TEXT)
    RETURNS BOOLEAN
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $fn$
      SELECT EXISTS (SELECT 1 FROM tenants WHERE slug = p_slug);
    $fn$;
    REVOKE ALL ON FUNCTION slug_in_use(TEXT) FROM PUBLIC;

    -- Create a workspace and its first administrator in one statement, so a
    -- failure cannot leave a tenant with nobody able to sign in.
    CREATE OR REPLACE FUNCTION create_tenant(
      p_tenant_id TEXT, p_name TEXT, p_slug TEXT, p_trial_ends_at TEXT,
      p_user_id TEXT, p_user_name TEXT, p_email TEXT, p_password_hash TEXT
    ) RETURNS VOID
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $fn$
    BEGIN
      INSERT INTO tenants (id, name, slug, status, plan, trial_ends_at)
      VALUES (p_tenant_id, p_name, p_slug, 'trial', 'trial', p_trial_ends_at);

      INSERT INTO users (id, tenant_id, name, email, password_hash, role,
                         is_active, is_super_admin)
      VALUES (p_user_id, p_tenant_id, p_user_name, p_email, p_password_hash,
              'admin', TRUE, TRUE);
    END;
    $fn$;
    REVOKE ALL ON FUNCTION create_tenant(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
  `);

  // The application role may call them; it still cannot read the tables
  // directly across tenants.
  if (process.env.DB_APP_ROLE) {
    await ddl.query(`
      GRANT EXECUTE ON FUNCTION find_login(TEXT) TO ${process.env.DB_APP_ROLE};
      GRANT EXECUTE ON FUNCTION find_refresh_tenant(TEXT) TO ${process.env.DB_APP_ROLE};
      GRANT EXECUTE ON FUNCTION email_in_use(TEXT) TO ${process.env.DB_APP_ROLE};
      GRANT EXECUTE ON FUNCTION slug_in_use(TEXT) TO ${process.env.DB_APP_ROLE};
      GRANT EXECUTE ON FUNCTION create_tenant(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO ${process.env.DB_APP_ROLE};
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${process.env.DB_APP_ROLE};
    `);
  }

  // No admin is seeded here any more. An account only exists inside a tenant,
  // and tenants are created by signing up - see routes/signup.js. A global
  // admin would belong to no tenant, so RLS would hide everything from it
  // anyway.
  await assertIsolationActive(pool);
  await ddl.end();

  console.log('DB: schema created');
  return _db;
}

function nowISO() {
  return new Date().toISOString();
}

module.exports = { getDb, getPool, initDb, nowISO };
