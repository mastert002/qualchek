-- Trial requests, platform operators, and the plan catalogue.
--
-- A workspace is no longer created by signing up. Someone asks for a trial, and
-- a QualChek operator approves it - so there is a decision point between a
-- stranger filling in a form and a workspace existing.
--
-- Two of these tables sit ABOVE tenants rather than inside one: a request has
-- no tenant yet (it may never get one), and a platform operator belongs to
-- QualChek rather than to any customer. Neither carries tenant_id, so the
-- tenant policies cannot scope them. Instead RLS is enabled with NO policy at
-- all, which denies the application role outright - the platform console
-- reaches them through SECURITY DEFINER functions, and a stray query from a
-- tenant request gets nothing.

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------
-- Priced by team size rather than per seat: a flat monthly fee for a cap on
-- people. Simpler to quote, and it does not punish a team for adding the
-- tester who was going to use it anyway.
CREATE TABLE IF NOT EXISTS plans (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  max_users INTEGER NOT NULL,
  price_monthly_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO plans (code, name, max_users, price_monthly_cents, sort_order) VALUES
  ('team3', 'Team of 3',  3, 1000, 1),
  ('team5', 'Team of 5',  5, 1500, 2),
  ('team8', 'Team of 8',  8, 2000, 3)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      max_users = EXCLUDED.max_users,
      price_monthly_cents = EXCLUDED.price_monthly_cents,
      sort_order = EXCLUDED.sort_order;

-- The catalogue is public: the request form has to show what is on offer.
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plans_readable ON plans;
CREATE POLICY plans_readable ON plans FOR SELECT USING (true);

-- ---------------------------------------------------------------------------
-- Platform operators
-- ---------------------------------------------------------------------------
-- Deliberately not rows in `users`. A QualChek operator is not a member of any
-- customer's workspace, and giving one a tenant_id would either put them inside
-- a customer's data or require an exception in every policy.
CREATE TABLE IF NOT EXISTS platform_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
);
ALTER TABLE platform_users ENABLE ROW LEVEL SECURITY;  -- no policy: app role denied

-- ---------------------------------------------------------------------------
-- Trial requests
-- ---------------------------------------------------------------------------
-- The password is captured now and hashed immediately, so approval can create a
-- working account without an invite email. The applicant chose it; making them
-- choose again after approval is friction for no gain.
CREATE TABLE IF NOT EXISTS trial_requests (
  id TEXT PRIMARY KEY,
  workspace_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  company_size TEXT,
  plan_code TEXT REFERENCES plans(code),
  note TEXT,
  password_hash TEXT NOT NULL,
  -- pending | approved | rejected
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
  ip_address TEXT,

  reviewed_by TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  decision_reason TEXT,

  -- Set when approved and the workspace is provisioned.
  tenant_id TEXT UNIQUE REFERENCES tenants(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_trial_requests_status ON trial_requests(status, submitted_at);
-- One live request per address: re-applying while a decision is pending would
-- give the operator two identical rows to reconcile.
CREATE UNIQUE INDEX IF NOT EXISTS idx_trial_requests_pending_email
  ON trial_requests (LOWER(email)) WHERE status = 'pending';

ALTER TABLE trial_requests ENABLE ROW LEVEL SECURITY;  -- no policy: app role denied

-- Tenants gain the plan they were approved onto.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_code TEXT REFERENCES plans(code);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS max_users INTEGER;

GRANT SELECT ON plans TO qualchek_app;
