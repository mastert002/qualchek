-- QualChek local development database.
--
-- Run as a superuser:
--   "C:\Program Files\PostgreSQL\18\bin\psql" -U postgres -f migrations/000-create-database.sql
--
-- Two roles on purpose. The application must NOT connect as the owner of its
-- own tables, because a table owner bypasses row-level security - and RLS is
-- what keeps one tenant's data away from another. If the app connects as the
-- owner, every policy written later is silently inert.

-- 1. The database.
CREATE DATABASE qualchek;

-- psql asks for the two passwords rather than them being written in this
-- file, so nothing secret ends up committed. They are echoed as you type,
-- which is acceptable for a local development database and not for anything
-- else.
\prompt 'Choose a password for qualchek_owner (migrations): ' owner_pw
\prompt 'Choose a password for qualchek_app (the application): ' app_pw

-- 2. The migration role owns the schema and runs DDL. Not used by the app.
CREATE ROLE qualchek_owner LOGIN PASSWORD :'owner_pw';
ALTER DATABASE qualchek OWNER TO qualchek_owner;

-- 3. The application role. Owns nothing, so RLS applies to it.
--    NOBYPASSRLS is the default, but stated explicitly because the whole
--    isolation model depends on it.
CREATE ROLE qualchek_app LOGIN PASSWORD :'app_pw' NOBYPASSRLS;

\connect qualchek

-- The app role may use the schema and the tables in it, but may not create,
-- drop or alter anything. Migrations run as the owner.
GRANT USAGE ON SCHEMA public TO qualchek_app;
ALTER DEFAULT PRIVILEGES FOR ROLE qualchek_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO qualchek_app;
ALTER DEFAULT PRIVILEGES FOR ROLE qualchek_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO qualchek_app;

-- Confirm the property the whole design rests on.
SELECT rolname, rolbypassrls, rolsuper
FROM pg_roles
WHERE rolname IN ('qualchek_owner', 'qualchek_app');
