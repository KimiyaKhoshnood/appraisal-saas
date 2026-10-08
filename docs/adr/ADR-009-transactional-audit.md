# ADR-009: Audit written in the same transaction, append-only, via in-process events

- Status: Accepted
- Date: 2026-10-07

## Problem
An audit log that can miss changes, or record changes that were rolled back, cannot be trusted.

## Decision
- Modules publish `DomainEvent`s on an in-process `EventBus` *inside* their transaction. The audit
  module subscribes and writes through `db.client`, which resolves to the ambient transaction:
  change and record commit or roll back together. audit depends on nothing but tenancy-core.
- Security events (failed login, permission denied, foreign-id probe, token reuse, host mismatch)
  are written outside the business transaction, best-effort, because the request is being rejected.
- `audit_log` is append-only twice over: the runtime role has only `SELECT, INSERT`, and a trigger
  rejects `UPDATE`/`DELETE` for every role, including the owner.
- Metadata holds identifiers and changed keys only. A sanitiser drops `score`, `comment`,
  `password`, `token` keys before writing (NF-06).

## Alternatives
An external queue (eventual consistency; a broker for no consumer); logging in controllers
(misses service-level changes, not transactional).

## Consequences
Audit writes are part of request latency (one INSERT on the same connection).

## Verification
`rls.spec.ts` (rollback removes both, UPDATE/DELETE/TRUNCATE denied, trigger stops the owner),
`evaluation.e2e.spec.ts` (every transition audited), unit test of the sanitiser.
