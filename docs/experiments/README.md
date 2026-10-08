# Experiments

Five research questions, six experiments: every architectural claim of the project is backed by a
test or a number. All scripts are in [`apps/api/experiments`](../../apps/api/experiments); results
(Markdown + raw JSON, with hardware and versions) are written to [`results/`](results).

| RQ | Topic | Experiments |
| --- | --- | --- |
| RQ1 | data isolation with a shared code base | E1, E3 |
| RQ2 | trade-offs of the database models | E2 |
| RQ3 | effect of customisation on maintainability | E5 |
| RQ4 | growth from a few to thousands of tenants | E3, E4, E6 |
| RQ5 | multi-tenant security risks | E1, E4, threat model |

## How to run

```bash
cd apps/api
pnpm db:bootstrap                                   # once: creates appraisal_bench as well
pnpm test:int                                       # E1 (isolation matrix, both modes) is part of the suite
pnpm exec tsx experiments/e3-rls-overhead.ts        # E3 (generates 50 tenants of data)
pnpm exec tsx experiments/e6-data-growth.ts         # E6 (100 tenants, 3.2 M score rows; ~10 min)
pnpm exec tsx experiments/e2-db-models.ts           # E2 (N = 10, 100, 500 schemas)
node -r @swc-node/register experiments/e4-noisy-neighbour.ts   # E4 (runs the real API in-process)
pnpm exec tsx experiments/e5-customisation-cost.ts  # E5 (counts from the code)
```

Rules (from the design): warm-up, at least five repetitions, median and p95, hardware recorded,
results stated as *relative* comparisons, never as absolute capacity.

## E1: isolation matrix (RQ1, RQ5)

Implemented as a test, [`test/e2e/isolation-matrix.e2e.spec.ts`](../../apps/api/test/e2e/isolation-matrix.e2e.spec.ts),
so it runs in CI on every change. Routes are enumerated from the application's route registry; a
new endpoint is attacked automatically, and an endpoint with a body but no sample makes the
coverage guard fail.

| check | mode "all layers" | mode "RLS only" (Prisma filter off) |
| --- | --- | --- |
| foreign id on every parameterised tenant route (22 routes) | 404 `NOT_FOUND` everywhere | 404 `NOT_FOUND` everywhere |
| any of B's ids in any of A's collection responses (16 routes) | none | none |
| B's ids smuggled into A's writes (role, manager, department) | 404 | 404 |
| B's data byte-for-byte unchanged after the attack | yes | yes |
| body of "foreign" vs "missing" 404 | identical | identical |
| probes recorded as security events | yes | yes |

Plus the raw-SQL variant (E1 v3) in [`test/integration/rls.spec.ts`](../../apps/api/test/integration/rls.spec.ts):
as the runtime role without a tenant setting, every one of the 17 tenant tables returns 0 rows.

## Results

- [E2 — shared schema vs schema per tenant](results/e2-db-models.md)
- [E3 — overhead of RLS and the transaction wrapper](results/e3-rls-overhead.md)
- [E4 — noisy neighbour](results/e4-noisy-neighbour.md)
- [E5 — cost of customisation](results/e5-customisation-cost.md)
- [E6 — data growth and tenant-first indexes](results/e6-data-growth.md)
