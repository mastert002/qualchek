// Create public.refresh_tokens on the existing database.
//
// initDb() returns early when public.users exists, so the CREATE TABLE added
// to database.js only runs on a brand-new database. This applies it once to
// the live one. Idempotent: every statement is IF NOT EXISTS.
//
// Explicitly schema-qualified, because Supabase ships its own
// auth.refresh_tokens for GoTrue and an unqualified name invites confusion.
require('dotenv').config();
const { Client } = require('pg');

const DDL = `
CREATE TABLE IF NOT EXISTS public.refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON public.refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON public.refresh_tokens(family_id);
`;

// RLS is enabled with no policies on every other table in this schema, which
// closes Supabase's REST API to it. The app connects as the table owner and
// bypasses RLS, so this changes nothing for the application - but a table left
// out would be readable through PostgREST, and this one holds session tokens.
const RLS = `ALTER TABLE public.refresh_tokens ENABLE ROW LEVEL SECURITY;`;

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query(DDL);
    await c.query(RLS);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }

  const cols = await c.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name='refresh_tokens' ORDER BY ordinal_position`);
  const idx = await c.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='refresh_tokens'`);
  const rls = await c.query(
    `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.refresh_tokens'::regclass`);

  console.log('columns:', cols.rows.map(r => `${r.column_name} ${r.data_type}`).join(', '));
  console.log('indexes:', idx.rows.map(r => r.indexname).join(', '));
  console.log('RLS    :', rls.rows[0].relrowsecurity);
  await c.end();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
