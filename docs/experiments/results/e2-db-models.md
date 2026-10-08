# E2: shared schema (A) vs schema per tenant (B)

_2026-10-08T03:05:26.105Z · 13th Gen Intel(R) Core(TM) i5-13420H (12 logical cores, 32 GB) · win32 10.0.22621 · Node v24.14.0 · PostgreSQL 18.3. PostgreSQL and the client on the same laptop (loopback); relative comparisons only._

B executes the project's real tenant DDL (54 statements: 17 tables, their indexes and
intra-tenant foreign keys) once per tenant. A executes the rows the onboarding service writes.
The "migration" adds a column plus a partial index to `evaluation` (empty tables in B; A's table
holds the bench data, so A is measured under *more* data than B).

| N tenants | A: provision one tenant (ms, median) | B: provision one tenant (ms, median) | A: one migration (s) | B: same migration on all N (s) | B / A migration | B: relations added to the catalog | B: pg_catalog growth (MB) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | 10.7 | 195.6 | 0.113 | 0.05 | 0.4× | 840 | 2.5 |
| 100 | 3.8 | 216.7 | 0.093 | 0.36 | 3.9× | 8,400 | 32.7 |
| 500 | 3.5 | 225 | 0.16 | 1.81 | 11.3× | 42,000 | 150.1 |

## Reading

- **Provisioning**: A writes a dozen small rows (≈ 3.5–11 ms, constant in N); B creates 54
  catalog objects per tenant (≈ 200–225 ms each, ≈ 60× slower) and every one of them stays in
  the catalog forever.
- **Migrations**: A runs once (≈ 0.1–0.16 s, even on a table holding 100 tenants of bench data);
  B runs N times and grows linearly (0.05 s → 0.36 s → 1.81 s for 10 → 100 → 500 tenants), i.e.
  ≈ 36 s at 10 000 tenants *on empty tables*. Adding a nullable/defaulted column is metadata-only
  in PostgreSQL ≥ 11; anything that rewrites data or builds an index on populated tables multiplies
  by the data size per schema, and a deploy must then keep N schemas consistent through partial
  failures. The time is not the main cost; the N-fold operational surface is.
- **Catalog**: B adds 84 relations per tenant (42 000 at N = 500) and ≈ 150 MB of catalog at
  N = 500. Planner caches, `pg_dump`, autovacuum and connection start-up all pay for it.
- **What B buys**: stronger structural isolation and easy per-tenant restore. In this project the
  isolation is delivered by RLS + composite keys (E1); per-tenant restore remains a documented
  limitation of model A.
- **Model C** (database per tenant) adds a CREATE DATABASE and one connection pool per tenant on
  top of B's costs; it fits a few very large or regulated tenants, which is why the
  `tenant_directory` (tenant → shard) table exists from day one.
