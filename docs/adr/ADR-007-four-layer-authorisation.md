# ADR-007: Four-layer authorisation; roles are rows, permissions are code

- Status: Accepted
- Date: 2026-10-07

## Problem
Mixing "which tenant", "which feature", "which action" and "which record" in one check is the
classic source of SaaS authorisation bugs.

## Decision
Four independent answers, evaluated in this order on every request:

| Layer | Question | Mechanism | Failure |
| --- | --- | --- | --- |
| Tenant boundary | whose data? | token `tid` + RLS | 403 mismatch / 0 rows → 404 |
| Feature gate | is the capability on for this tenant? | `@RequireFeature` + FeatureGuard | 404 (the route "does not exist") |
| RBAC | may this role do this? | `@RequirePermission` + PermissionGuard | 403 + security event |
| Scope | may this user touch *this* record? | domain service (e.g. manager → direct reports) | 404 |

- Permissions are a code catalog (`PERMISSIONS` in contracts) synced into a read-only table; roles
  are per-tenant rows created from system templates. Custom roles (TA-08) need no code change.
- Roles are **not** in the JWT. Effective permissions are cached under `(tenant, user,
  authz_version)`; iam bumps the version on any role, assignment or user-status change, so a change
  (including deactivation) applies on the user's next request.
- **Privilege ceiling** (added after an internal security review found two escalations: `user:write`
  could create a Tenant admin, and `role:write` was equivalent to every permission): a user can only
  grant permissions they hold, only manage users whose permissions are a subset of their own, and
  the tenant always keeps at least one active Tenant admin (checked under a row lock, so two admins
  demoting each other concurrently cannot both succeed). See `iam/grant-policy.ts`.
- Every route must declare exactly one policy (`@Public`, `@PlatformRoute`, `@RequirePermission`,
  `@Authenticated`); the application **refuses to boot** otherwise (secure by default).

## Alternatives
Roles inside the JWT: stale for the token's lifetime and invisible to revocation.

## Consequences
One small read per request (the version), covered by the cache.

## Verification
`configuration-rbac.e2e.spec.ts` (403s audited, role change without re-login, deactivation,
custom roles, privilege-ceiling and last-admin tests), `RouteRegistry.verify()` at boot, the isolation matrix for scope.
