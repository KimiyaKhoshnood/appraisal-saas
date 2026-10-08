# E3: overhead of RLS and of the transaction wrapper

_2026-10-08T02:42:21.158Z · 13th Gen Intel(R) Core(TM) i5-13420H (12 logical cores, 32 GB) · win32 10.0.22621 · Node v24.14.0 · PostgreSQL 18.3. PostgreSQL and the client on the same laptop (loopback); relative comparisons only._

Data: 50 tenants × 100 employees × 4 cycles × 10 competencies
(19,800 evaluations). 1000 sequential calls per variant per run, 5 runs after a
warm-up run, variants interleaved; one connection per variant, all as the runtime role. Cells are **median / p95 in ms**.

| query | V0 no RLS | V1 RLS predicate | V2 RLS + tx wrapper | V3 Prisma (app) | Δ RLS ms (V1−V0) | Δ wrapper ms (V2−V1) | Δ ORM ms (V3−V2) | run-median range V0 · V1 · V2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| team list | 0.28 / 0.69 | 0.24 / 0.59 | 0.48 / 1.2 | 1.97 / 3.69 | -0.04 | +0.25 | +1.48 | 0.21–0.44 · 0.2–0.4 · 0.39–0.69 |
| point lookup | 0.19 / 0.52 | 0.23 / 0.69 | 0.41 / 1.03 | 1.81 / 3.67 | +0.04 | +0.18 | +1.4 | 0.14–0.27 · 0.16–0.37 · 0.36–0.46 |
| page of 50 | 0.32 / 0.77 | 0.26 / 0.75 | 0.51 / 1.12 | 2.04 / 4.34 | -0.06 | +0.25 | +1.53 | 0.21–0.57 · 0.24–0.36 · 0.43–0.54 |

Sub-millisecond deltas of either sign are within run-to-run variation (last column): at this
resolution the honest statement is an upper bound, not a percentage.

Per-run medians are in `e3-rls-overhead.json` (`runMedians`) to show stability.

## Reading

- **RLS predicate (V1 vs V0).** PostgreSQL treats `current_setting('app.tenant_id')` as a
  stable value and folds the policy into the index condition (plan below), so the predicate
  costs about as much as the explicit `tenant_id = $1` it duplicates: the measured differences
  are a few tenths of a millisecond at most, of either sign, i.e. within run-to-run variation.
- **Transaction wrapper (V2 vs V1).** The real price of the design is three extra round trips per
  operation (BEGIN, set_config, COMMIT). On loopback that is a fraction of a millisecond; across a
  network it scales with latency. This is risk R3. The mitigation is already in the code:
  `Database.transaction()` sets the tenant once for many statements (used for every request's
  access check and for all writes).
- **ORM (V3 vs V2).** Query compilation and mapping in Prisma 7's TypeScript engine; independent
  of tenancy and the dominant term at this scale. NF-08 is therefore met with a large margin: the
  tenancy machinery is a small fraction of a 2–3 ms ORM call.

## Plan: tenant predicate supplied by RLS only (no `tenant_id` in the SQL text)

```
Index Scan using evaluation_by_cycle_status on evaluation (actual rows=9.00 loops=1)
  Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (cycle_id = '01a1195f-d79c-7309-b495-6ab300b51e43'::uuid))
  Filter: (manager_id = '01a1195f-d5ee-72d0-8d24-ca8aa7a50e24'::uuid)
  Rows Removed by Filter: 90
  Index Searches: 1
```
