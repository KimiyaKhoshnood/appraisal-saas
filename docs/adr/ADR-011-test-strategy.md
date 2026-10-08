# ADR-011: Test strategy: isolation matrix and boundaries in CI

- Status: Accepted
- Date: 2026-10-07

## Decision
| Level | Tool | What it proves |
| --- | --- | --- |
| Unit | Vitest | pure logic: tenant scoping of every Prisma operation, the state machine (exhaustive snapshot for all policy combinations), approval strategies, scoring, contracts, limiter, host parsing, logging redaction |
| Integration | Vitest + real PostgreSQL 18 | RLS catalog guarantees, privileges, fail-closed reads, WITH CHECK, composite FKs, append-only audit, pool concurrency, transaction atomicity |
| End-to-end | Vitest + Supertest + full Nest app | auth, RBAC, configuration, evaluation flows, platform life-cycle |
| Isolation matrix (E1) | generated from the RouteRegistry | every parameterised tenant route attacked with another tenant's ids, with and without the application filter |
| Architecture | dependency-cruiser, ESLint | module boundaries, no tenant-specific code |

Tests run against a real database because the guarantees under test *are* database behaviour;
mocking PostgreSQL would test the mock. The test database is rebuilt from the migrations once per
run. Coverage gates: ≥ 85 % lines overall and on tenancy-core, ≥ 80 % on iam and configuration.

## Consequences
CI needs a PostgreSQL service (≈ 1 minute of e2e). Accepted: the isolation claims of the project
rest on these tests.

## Verification
`.github/workflows/ci.yml`.
