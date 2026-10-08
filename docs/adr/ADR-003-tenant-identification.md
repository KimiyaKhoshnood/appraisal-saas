# ADR-003: Tenant from a signed JWT claim; the sub-domain is only a hint

- Status: Accepted
- Date: 2026-10-07

## Problem
Every request must be attributed to exactly one tenant, and the attribution must not be forgeable.

## Decision
- After login the tenant is the signed `tid` claim of the access token, and nothing else.
- Before login (login page, public branding) the sub-domain selects the tenant, for
  non-sensitive data only (name, logo, colours).
- On every authenticated request the sub-domain must equal the token's tenant, otherwise
  403 `TENANT_MISMATCH` plus a security event in the token's tenant.
- The tenant id is never accepted from a body, query, path or header. Request schemas are strict,
  so a smuggled `tenantId` field is a 400, not silently ignored.
- Slugs: lowercase letters, digits and inner hyphens, 3–40 characters, reserved names refused,
  **immutable** (a database trigger rejects any update).

## Alternatives
An `X-Tenant-ID` header (trivially forgeable); a path prefix such as `/t/acme` (no DNS needed, but
more complex routing and branding, and it loses per-tenant cookie isolation).

## Consequences
Production needs wildcard DNS and a wildcard certificate. In development, `*.localhost` resolves
to loopback in current browsers. Refresh cookies are set without a `Domain` attribute, so each
tenant's cookie is only ever sent to its own sub-domain.

## Verification
`auth.e2e.spec.ts` (host mismatch, cookie attributes, foreign refresh cookie), unit tests of
`classifyHost`, mass-assignment tests in `configuration-rbac.e2e.spec.ts`.
