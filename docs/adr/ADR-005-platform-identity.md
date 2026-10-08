# ADR-005: Separate identity for platform administrators

- Status: Accepted
- Date: 2026-10-07

## Problem
The platform operator is the highest-value target (T7). How should it be represented?

## Decision
Platform admins live in `platform_admin` (no `tenant_id`), sign in on `admin.<base>` only, and get
tokens signed with a **different key** for a **different audience** (`platform-api`). Tenant tokens
are rejected on platform routes and vice versa. Admins are created by an operator script using the
migrator role; the runtime role can only read them and update `last_login_at`.

## Alternatives
A `SUPER_ADMIN` role inside the tenant users table: one account type away from every tenant's
data, and the platform would have to bypass RLS to do its job.

## Consequences
Two login flows and two refresh-token tables. The platform admin has **no route** to evaluation
data at all (least privilege).

## Verification
`auth.e2e.spec.ts` and `platform.e2e.spec.ts`: cross-use of tokens, host restriction, no access to
tenant routes. Boot-time validation refuses identical tenant and platform keys.
