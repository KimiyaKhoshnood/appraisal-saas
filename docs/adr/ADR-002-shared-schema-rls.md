# ADR-002: One database, one shared schema, Row-Level Security

- Status: Accepted
- Date: 2026-10-07

## Problem
Choose a tenant data-isolation model that is safe, cheap to operate and compatible with Prisma.

## Decision
Model A: all tenants share the tables. Every tenant table has `tenant_id`, `ENABLE` **and
`FORCE`** row-level security (so even the table owner is subject to it) and one policy:

```sql
USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
```

Without a setting the comparison is NULL and nothing is visible: fail closed. Children reference
parents through composite keys `(tenant_id, id)`, so a row can never point into another tenant,
whatever the application does.

## Alternatives
- Schema per tenant (B): migrations run N times, Prisma's client is bound to one schema, the
  catalog grows with N. Measured in E2.
- Database per tenant (C): strongest isolation, highest cost (connections, provisioning, backups).

## Consequences
Noisy neighbours share resources (mitigated by per-tenant rate limits, `statement_timeout` and
page-size caps; measured in E4). Restoring one tenant is harder (filtered export). A future hybrid
(large tenant on a dedicated database) is prepared by the `tenant_directory` (tenant → shard) table.

## Verification
- `test/integration/rls.spec.ts`: every table with a `tenant_id` column has FORCE RLS and the policy
  (a catalog query, so a forgotten policy on a *future* table fails CI); zero rows without context;
  WITH CHECK; composite foreign keys.
- The E1 isolation matrix in "RLS only" mode (application filter switched off) still answers 404
  on every route.
- E2 for the cost comparison of A and B.
