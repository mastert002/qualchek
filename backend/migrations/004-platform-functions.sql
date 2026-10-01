-- How the application reaches tables it is otherwise denied.
--
-- platform_users and trial_requests have row-level security on with no policy,
-- so the application role cannot touch them directly. Everything it legitimately
-- needs goes through these functions, each owned by the schema owner and each
-- narrow enough to read on its own. The alternative - granting the app role
-- direct access - would mean a stray query from a tenant request could read
-- every applicant's details.

-- Submit a request. Returns the new id, or null when an address already has one
-- pending, so the caller can answer identically either way and not confirm
-- whether somebody has applied before.
CREATE OR REPLACE FUNCTION submit_trial_request(
  p_id TEXT, p_workspace TEXT, p_contact TEXT, p_email TEXT, p_phone TEXT,
  p_company_size TEXT, p_plan_code TEXT, p_note TEXT, p_password_hash TEXT, p_ip TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  INSERT INTO trial_requests (id, workspace_name, contact_name, email, phone,
                              company_size, plan_code, note, password_hash, ip_address)
  VALUES (p_id, p_workspace, p_contact, LOWER(p_email), p_phone,
          p_company_size, p_plan_code, p_note, p_password_hash, p_ip);
  RETURN p_id;
EXCEPTION WHEN unique_violation THEN
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION submit_trial_request(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;

-- Authenticate a platform operator. Mirrors find_login for tenant users.
CREATE OR REPLACE FUNCTION find_platform_login(p_email TEXT)
RETURNS TABLE (user_id TEXT, name TEXT, password_hash TEXT, is_active BOOLEAN)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  SELECT id, name, password_hash, is_active
  FROM platform_users WHERE LOWER(email) = LOWER(p_email) LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION find_platform_login(TEXT) FROM PUBLIC;

-- The review queue. Never returns password_hash: an operator deciding on a
-- request has no reason to see it, and it would end up in a log or a browser.
CREATE OR REPLACE FUNCTION list_trial_requests(p_status TEXT, p_limit INTEGER)
RETURNS TABLE (
  id TEXT, workspace_name TEXT, contact_name TEXT, email TEXT, phone TEXT,
  company_size TEXT, plan_code TEXT, note TEXT, status TEXT, submitted_at TEXT,
  reviewed_at TEXT, decision_reason TEXT, tenant_id TEXT, reviewer_name TEXT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  SELECT r.id, r.workspace_name, r.contact_name, r.email, r.phone,
         r.company_size, r.plan_code, r.note, r.status, r.submitted_at,
         r.reviewed_at, r.decision_reason, r.tenant_id, p.name
  FROM trial_requests r
  LEFT JOIN platform_users p ON p.id = r.reviewed_by
  WHERE p_status IS NULL OR r.status = p_status
  ORDER BY (r.status = 'pending') DESC, r.submitted_at DESC
  LIMIT COALESCE(p_limit, 100);
$fn$;
REVOKE ALL ON FUNCTION list_trial_requests(TEXT,INTEGER) FROM PUBLIC;

-- Approve a request: provision the workspace, its first admin, and the trial,
-- then mark the request decided. One statement, so a failure cannot leave a
-- workspace with nobody able to sign in - or an approved request pointing at
-- nothing.
CREATE OR REPLACE FUNCTION approve_trial_request(
  p_request_id TEXT, p_reviewer_id TEXT, p_tenant_id TEXT, p_slug TEXT,
  p_user_id TEXT, p_trial_ends_at TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE r trial_requests%ROWTYPE; cap INTEGER;
BEGIN
  SELECT * INTO r FROM trial_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'request already %', r.status; END IF;

  SELECT max_users INTO cap FROM plans WHERE code = r.plan_code;

  INSERT INTO tenants (id, name, slug, status, plan, plan_code, max_users, trial_ends_at)
  VALUES (p_tenant_id, r.workspace_name, p_slug, 'trial',
          COALESCE(r.plan_code, 'team3'), r.plan_code, COALESCE(cap, 3), p_trial_ends_at);

  INSERT INTO users (id, tenant_id, name, email, password_hash, role, is_active, is_super_admin)
  VALUES (p_user_id, p_tenant_id, r.contact_name, r.email, r.password_hash,
          'admin', TRUE, TRUE);

  UPDATE trial_requests
     SET status = 'approved', reviewed_by = p_reviewer_id,
         reviewed_at = NOW()::TEXT, tenant_id = p_tenant_id
   WHERE id = p_request_id;

  RETURN p_tenant_id;
END;
$fn$;
REVOKE ALL ON FUNCTION approve_trial_request(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION reject_trial_request(p_request_id TEXT, p_reviewer_id TEXT, p_reason TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE n INTEGER;
BEGIN
  UPDATE trial_requests
     SET status = 'rejected', reviewed_by = p_reviewer_id,
         reviewed_at = NOW()::TEXT, decision_reason = p_reason
   WHERE id = p_request_id AND status = 'pending';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$fn$;
REVOKE ALL ON FUNCTION reject_trial_request(TEXT,TEXT,TEXT) FROM PUBLIC;

-- Counts for the console header.
CREATE OR REPLACE FUNCTION trial_request_counts()
RETURNS TABLE (pending BIGINT, approved BIGINT, rejected BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  SELECT COUNT(*) FILTER (WHERE status = 'pending'),
         COUNT(*) FILTER (WHERE status = 'approved'),
         COUNT(*) FILTER (WHERE status = 'rejected')
  FROM trial_requests;
$fn$;
REVOKE ALL ON FUNCTION trial_request_counts() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION submit_trial_request(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO qualchek_app;
GRANT EXECUTE ON FUNCTION find_platform_login(TEXT) TO qualchek_app;
GRANT EXECUTE ON FUNCTION list_trial_requests(TEXT,INTEGER) TO qualchek_app;
GRANT EXECUTE ON FUNCTION approve_trial_request(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO qualchek_app;
GRANT EXECUTE ON FUNCTION reject_trial_request(TEXT,TEXT,TEXT) TO qualchek_app;
GRANT EXECUTE ON FUNCTION trial_request_counts() TO qualchek_app;
