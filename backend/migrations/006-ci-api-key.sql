-- Resolving a CI API key to its workspace.
--
-- A pipeline presents only a key. Which workspace it belongs to is the thing
-- being looked up, and `users` is policy-scoped - so with no tenant context the
-- lookup matches nothing and every CI call is rejected. Same shape as
-- find_login: a narrow SECURITY DEFINER function rather than giving the
-- application a role that ignores row-level security.
--
-- Returns the tenant's status too, so a suspended workspace's pipeline is told
-- why rather than silently finding no test cases.
CREATE OR REPLACE FUNCTION find_api_key(p_key TEXT)
RETURNS TABLE (user_id TEXT, tenant_id TEXT, name TEXT, email TEXT,
               role TEXT, is_active BOOLEAN, tenant_status TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  SELECT u.id, u.tenant_id, u.name, u.email, u.role, u.is_active, t.status
  FROM users u
  JOIN tenants t ON t.id = u.tenant_id
  WHERE u.api_key = p_key
  LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION find_api_key(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_api_key(TEXT) TO qualchek_app;
