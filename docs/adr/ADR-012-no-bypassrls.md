# ADR-012: No runtime role bypasses RLS; the platform enters a tenant instead

- Status: Accepted (D5 resolved, see below)
- Date: 2026-10-07

## Decision
Three roles: `appraisal_migrator` owns the schema and runs migrations; `app_runtime` (NOLOGIN)
receives the grants; `appraisal_app` logs in as a member of `app_runtime`. None is superuser,
none has `BYPASSRLS`, the runtime owns no table, and `FORCE ROW LEVEL SECURITY` subjects even the
owner to the policies.

Platform operations on a tenant (onboarding, the seed) *enter the tenant's context*
(`TenantContext.runAs`) and write through the same policies as everyone else. Tenant creation is
one transaction inside the new tenant's context: tenant row, directory entry, settings, branding,
features, roles, first admin, audit records; all or nothing.

**D5 (cross-tenant statistics):** resolved without BYPASSRLS. The platform console lists tenants
with status and plan from the platform tables only. If aggregate statistics are needed later,
the plan is a platform-owned counters table updated by events, not a privileged role.

## Alternatives
A `platform_reader` role with `BYPASSRLS`: one leaked connection string reads everything.

## Consequences
Cross-tenant analytics are deliberately inconvenient.

## Verification
`rls.spec.ts` checks the runtime role's attributes, memberships and ownerships; `platform.e2e.spec.ts`
proves onboarding is atomic; the seed itself provisions tenants through the API services.
