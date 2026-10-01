// Per-request tenant context.
//
// Isolation between tenants is enforced by Postgres row-level security, not by
// remembering to add `WHERE tenant_id = ?` to ~164 queries. The policies read
// the current tenant from a session setting, `app.tenant_id`, so something has
// to put it there - correctly - for the duration of each request.
//
// Two things make that harder than it sounds in this codebase:
//
//   1. The pool is configured `max: 1`. Every query in the process shares one
//      connection, so a setting applied by request A is visible to request B
//      running concurrently. Setting it with pool.query() would mean one
//      tenant's request reading another tenant's rows - a data leak, not a
//      race to tidy up later. So each request checks out a client of its own
//      and every query it makes must go to THAT client.
//
//   2. `db.prepare(...)` is called in ~164 places, none of which take a
//      connection. Threading one through all of them would be a huge diff and
//      a permanent trap: the one call site somebody forgets is the one that
//      leaks. AsyncLocalStorage carries it implicitly instead, so the existing
//      call sites keep working unchanged and correctly.
//
// Code that runs outside a request - startup, migrations, background crawl
// jobs - has no context, falls back to the pool, and is unaffected by the
// policies because it connects as the owner.

const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

/** The client bound to the current request, or null outside one. */
const currentClient = () => {
  const store = storage.getStore();
  return store ? store.client : null;
};

/** The tenant id bound to the current request, or null outside one. */
const currentTenantId = () => {
  const store = storage.getStore();
  return store ? store.tenantId : null;
};

/**
 * Run `fn` with a dedicated client whose session is pinned to one tenant.
 *
 * set_config(..., false) applies for the life of the session rather than a
 * transaction, which avoids holding a transaction open across a whole request -
 * a crawl can take a minute, and an open transaction that long blocks vacuum
 * and holds locks. The client is exclusively ours until release, so a
 * session-level setting is safe here in a way it would not be on a shared one.
 *
 * @param {import('pg').Pool} pool
 * @param {string|null} tenantId null runs with no tenant, which RLS reads as
 *   "match nothing" - the correct default for an unauthenticated request.
 */
async function withTenant(pool, tenantId, fn) {
  const client = await pool.connect();
  try {
    await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenantId || '']);
    return await storage.run({ client, tenantId: tenantId || null }, fn);
  } finally {
    // Clear before returning the client to the pool. Without this the next
    // borrower inherits this tenant until it sets its own - and a code path
    // that forgets to set one would read this tenant's rows.
    try {
      await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', '']);
    } catch { /* a broken connection is discarded by the pool anyway */ }
    client.release();
  }
}

module.exports = { withTenant, currentClient, currentTenantId };
