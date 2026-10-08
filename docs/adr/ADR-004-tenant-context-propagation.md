# ADR-004: AsyncLocalStorage + Prisma client extension + transaction-local set_config

- Status: Accepted
- Date: 2026-10-07

## Problem
Prisma has no native RLS support (risk R1). The tenant must reach PostgreSQL on every query
without every call site passing it, and without leaking across pooled connections.

## Decision
1. **Layer 1, context.** A request-scoped `AsyncLocalStorage` store is opened by the first
   middleware. Only the tenant guard (from a verified token) and `TenantContext.runAs` (platform
   operations, seed) write `tenantId`. Tenant models refuse to run without it.
2. **Layer 2, query.** A Prisma client extension adds `tenantId` predicates to every operation on
   a tenant model and stamps it on writes; an unknown operation fails closed.
3. **Layer 3, database.** Each operation runs in a transaction that starts with
   `set_config('app.tenant_id', $1, true)`; `true` makes it transaction-local. `Database.transaction()`
   opens one interactive transaction, sets the tenant once and puts the transaction client in the
   context, so nested calls join it.

A session-level `SET` is forbidden: on pooled connections it leaks one request's tenant into the next.

## Alternatives
Passing `tenantId` by hand (one forgotten call is a leak); session-level `SET` (leaks across the
pool); a raw-SQL data layer (the fallback plan of R1, not needed).

## Consequences
BEGIN, set_config and COMMIT around each standalone operation: about 0.2 ms on loopback (E3); the
RLS predicate itself is free. Prisma promises are lazy, so every scope (`transaction`, `runAs`)
awaits the callback *inside* the scope. Two bugs of exactly this kind were found by the tests and
the experiments, and both now have regression tests.

## Verification
`rls.spec.ts`: 200 concurrent mixed operations of two tenants on one pool never see each other; a
single-connection pool test (an accidental second connection inside a transaction would deadlock);
the change and its audit record roll back together. E3 for the cost.
