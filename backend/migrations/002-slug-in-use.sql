-- Whether a workspace handle is taken.
--
-- Crosses tenants by nature: slugs are unique across the install, but `tenants`
-- is policy-scoped and signup runs with no tenant context - so a plain SELECT
-- sees nothing and every new workspace is told its preferred slug is free.
-- Returns only a boolean, so it cannot be used to enumerate customers.
CREATE OR REPLACE FUNCTION slug_in_use(p_slug TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (SELECT 1 FROM tenants WHERE slug = p_slug);
$fn$;
REVOKE ALL ON FUNCTION slug_in_use(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION slug_in_use(TEXT) TO qualchek_app;
