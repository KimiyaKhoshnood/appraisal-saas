-- Tenant isolation, least-privilege grants and integrity rules (ADR-002, ADR-004, ADR-012).
--
-- Layer 3 of the five isolation layers: even if application code forgets a filter or runs raw
-- SQL, PostgreSQL itself hides every row whose tenant_id differs from the transaction-local
-- setting `app.tenant_id`. With no setting the comparison is NULL and no row is visible
-- (fail closed, NF-02).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    RAISE EXCEPTION 'role app_runtime is missing: run scripts/db-bootstrap.ts before migrating';
  END IF;
END
$$;

-- ── Row-level security on every tenant-scoped table ─────────────────────────
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'tenant_settings', 'tenant_authz_state', 'tenant_feature', 'tenant_branding',
    'app_user', 'role', 'role_permission', 'user_role', 'refresh_token',
    'department', 'employee_profile',
    'evaluation_cycle', 'competency', 'evaluation', 'evaluation_score', 'approval_record',
    'audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE: the table owner is subject to the policy too; nobody is exempt by ownership.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING      (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)
         WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
  END LOOP;
END
$$;

-- ── Grants: the runtime role owns nothing and gets only what it needs ───────
GRANT USAGE ON SCHEMA public TO app_runtime;
-- Read-only catalogs (synced from code by the migrator).
GRANT SELECT ON permission, feature_definition, plan, plan_feature TO app_runtime;
-- Platform lifecycle tables: no DELETE; a tenant is suspended or archived, never erased by the API.
GRANT SELECT, INSERT, UPDATE ON tenant, tenant_directory TO app_runtime;
-- Platform admins are created by an operator script (migrator); the API only reads them.
GRANT SELECT, UPDATE (last_login_at) ON platform_admin TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON platform_refresh_token TO app_runtime;
GRANT SELECT, INSERT ON platform_audit_log TO app_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenant_settings, tenant_authz_state, tenant_feature, tenant_branding,
  app_user, role, role_permission, user_role, refresh_token,
  department, employee_profile,
  evaluation_cycle, competency, evaluation, evaluation_score, approval_record
TO app_runtime;

-- Audit is append-only for the runtime role (AD-03, T12).
GRANT SELECT, INSERT ON audit_log TO app_runtime;

-- ── Append-only audit, enforced for every role including the owner ──────────
CREATE FUNCTION forbid_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit records are append-only (% on %)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();
CREATE TRIGGER platform_audit_log_append_only
  BEFORE UPDATE OR DELETE ON platform_audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();

-- ── The slug is immutable: sub-domain = brand identity + security boundary ──
CREATE FUNCTION forbid_slug_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'tenant slug is immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tenant_slug_immutable
  BEFORE UPDATE OF slug ON tenant
  FOR EACH ROW EXECUTE FUNCTION forbid_slug_change();

-- ── Domain invariants the database can check cheaply ────────────────────────
ALTER TABLE tenant
  ADD CONSTRAINT tenant_slug_format
  CHECK (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' AND length(slug) BETWEEN 3 AND 40 AND slug NOT LIKE '%--%');

ALTER TABLE tenant_branding
  ADD CONSTRAINT tenant_branding_colors
  CHECK (primary_color ~ '^#[0-9a-f]{6}$' AND secondary_color ~ '^#[0-9a-f]{6}$');

ALTER TABLE employee_profile
  ADD CONSTRAINT employee_profile_not_own_manager CHECK (manager_id IS NULL OR manager_id <> user_id);

ALTER TABLE competency
  ADD CONSTRAINT competency_weight_range CHECK (weight BETWEEN 1 AND 100);

ALTER TABLE evaluation_score
  ADD CONSTRAINT evaluation_score_range CHECK (score BETWEEN 0 AND 10);

ALTER TABLE approval_record
  ADD CONSTRAINT approval_record_stage CHECK (stage BETWEEN 1 AND 2);

-- ── Indexes Prisma cannot express ───────────────────────────────────────────
-- A manager's open work: tiny partial index, the hot path of the team dashboard.
CREATE INDEX evaluation_open_by_manager
  ON evaluation (tenant_id, manager_id)
  WHERE status <> 'PUBLISHED';

CREATE INDEX evaluation_by_cycle_status
  ON evaluation (tenant_id, cycle_id, status);
