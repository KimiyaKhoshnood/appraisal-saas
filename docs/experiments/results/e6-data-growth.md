# E6: data growth and tenant-first indexes

_2026-10-08T02:54:53.496Z · 13th Gen Intel(R) Core(TM) i5-13420H (12 logical cores, 32 GB) · win32 10.0.22621 · Node v24.14.0 · PostgreSQL 18.3. PostgreSQL and the client on the same laptop (loopback); relative comparisons only._

Data: 100 tenants × 200 employees × 4 cycles × 20 competencies × 2 evaluators,
plus 10,000 audit entries per tenant.

| table | rows (estimate) | size incl. indexes |
| --- | --- | --- |
| app_user | 20,000 | 7288 kB |
| audit_log | 999,997 | 301 MB |
| evaluation | 79,600 | 27 MB |
| evaluation_score | 3,184,000 | 638 MB |

Each query runs as the runtime role inside a tenant transaction (RLS on), 200 times after warm-up.
"buffers" = 8 kB pages touched by one execution (EXPLAIN BUFFERS): the scale-independent signal.

| query | tenant | index layout | median ms | p95 ms | buffers | access path |
| --- | --- | --- | --- | --- | --- | --- |
| audit: latest 50 entries of a tenant | oldest | tenant-first | 1.15 | 3.5 | 6 | `->  Index Scan using audit_log_tenant_id_id_idx on audit_log` |
| audit: latest 50 entries of a tenant | newest | tenant-first | 0.53 | 1.06 | 8 | `->  Index Scan using audit_log_tenant_id_id_idx on audit_log` |
| audit: latest 50 entries of a tenant | oldest | global | 24.01 | 38.54 | 154 | `->  Index Scan Backward using audit_log_pkey on audit_log` |
| audit: latest 50 entries of a tenant | newest | global | 16.52 | 25.38 | 104 | `->  Index Scan Backward using audit_log_pkey on audit_log` |
| audit: latest 50 entries of a tenant | oldest | none | 24.24 | 37.15 | 154 | `->  Index Scan Backward using audit_log_pkey on audit_log` |
| audit: latest 50 entries of a tenant | newest | none | 15.83 | 25.35 | 104 | `->  Index Scan Backward using audit_log_pkey on audit_log` |
| team: a manager's open evaluations | oldest | tenant-first | 0.55 | 1.37 | 4 | `Index Scan using evaluation_open_by_manager on evaluation` |
| team: a manager's open evaluations | newest | tenant-first | 0.47 | 0.96 | 4 | `Index Scan using evaluation_open_by_manager on evaluation` |
| team: a manager's open evaluations | oldest | global | 1.56 | 3.36 | 4 | `Index Scan using e6_team_global on evaluation` |
| team: a manager's open evaluations | newest | global | 0.65 | 1.95 | 4 | `Index Scan using e6_team_global on evaluation` |
| team: a manager's open evaluations | oldest | none | 1.22 | 2.28 | 32 | `Index Scan using evaluation_by_cycle_status on evaluation` |
| team: a manager's open evaluations | newest | none | 0.87 | 1.71 | 31 | `Index Scan using evaluation_by_cycle_status on evaluation` |
| cycle: status counts of a cycle | oldest | tenant-first | 0.51 | 1.04 | 3 | `->  Index Only Scan using evaluation_by_cycle_status on evaluation` |
| cycle: status counts of a cycle | newest | tenant-first | 0.53 | 1.09 | 4 | `->  Index Only Scan using evaluation_by_cycle_status on evaluation` |
| cycle: status counts of a cycle | oldest | global | 1.13 | 2.33 | 46 | `->  Index Scan using evaluation_tenant_id_cycle_id_employee_id_key on evaluation` |
| cycle: status counts of a cycle | newest | global | 0.47 | 0.94 | 47 | `->  Index Scan using evaluation_tenant_id_cycle_id_employee_id_key on evaluation` |
| cycle: status counts of a cycle | oldest | none | 0.6 | 2.33 | 42 | `->  Index Scan using evaluation_tenant_id_cycle_id_employee_id_key on evaluation` |
| cycle: status counts of a cycle | newest | none | 0.49 | 1.06 | 47 | `->  Index Scan using evaluation_tenant_id_cycle_id_employee_id_key on evaluation` |
| scores: all scores of one evaluation | oldest | tenant-first | 1.93 | 3.72 | 26 | `Index Scan using evaluation_score_tenant_id_evaluation_id_competency_id_eval_key on evaluation_score` |
| scores: all scores of one evaluation | newest | tenant-first | 0.48 | 1.21 | 26 | `Index Scan using evaluation_score_tenant_id_evaluation_id_competency_id_eval_key on evaluation_score` |
| scores: all scores of one evaluation | oldest | global | 1.48 | 2.1 | 25 | `Bitmap Heap Scan on evaluation_score` |
| scores: all scores of one evaluation | newest | global | 1.64 | 3.27 | 24 | `Bitmap Heap Scan on evaluation_score` |
| scores: all scores of one evaluation | oldest | none | 240.33 | 388.98 | 39309 | `->  Parallel Seq Scan on evaluation_score` |
| scores: all scores of one evaluation | newest | none | 230.07 | 358.4 | 39309 | `->  Parallel Seq Scan on evaluation_score` |

## Reading

- **Where the tenant is the selective column, tenant-first indexes are decisive.** The audit
  page ("latest 50 of my tenant") with only the global primary key walks the id index newest-first
  and lets RLS discard every other tenant's row. Its cost then depends on *where the tenant's rows
  sit in the global order*: cheap for the newest tenant, a scan of most of the index for the oldest
  one, i.e. it grows with the total number of tenants and with how quiet a tenant is. With
  `(tenant_id, id DESC)` both tenants read the same handful of pages. Cycle aggregates show the
  same effect in buffers (index-only scan of one tenant's slice).
- **Where another column is already selective, a global index is as good.** A manager id or an
  evaluation id identifies rows of one tenant anyway, so `(manager_id)` or `(evaluation_id, …)`
  touch as few pages as the tenant-first versions; the differences in milliseconds are noise. The
  tenant-first form is kept there for uniformity and because it also serves tenant-wide scans.
- **No index is catastrophic at this size**: all scores of one evaluation fall back to a parallel
  sequential scan of 3.2 M rows (hundreds of ms, ~40 k pages) instead of ~1 ms.
- **NF-07** (p95 of list queries < 300 ms with 100 tenants of data): met with a wide margin by the
  shipped layout (single-digit milliseconds p95 for every query, both tenants).

## Plans (tenant-first layout)

### audit: latest 50 entries of a tenant
```
Limit (actual rows=50.00 loops=1)
  Buffers: shared hit=3 read=3
  ->  Index Scan using audit_log_tenant_id_id_idx on audit_log (actual rows=50.00 loops=1)
        Index Cond: (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)
        Index Searches: 1
        Buffers: shared hit=3 read=3
Planning:
  Buffers: shared hit=118 read=1
```

### team: a manager's open evaluations
```
Index Scan using evaluation_open_by_manager on evaluation (actual rows=10.00 loops=1)
  Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (manager_id = '01a11965-cd67-76a3-a862-28a1bc96fa5b'::uuid))
  Index Searches: 1
  Buffers: shared hit=2 read=2
Planning:
  Buffers: shared hit=132 read=2
```

### cycle: status counts of a cycle
```
GroupAggregate (actual rows=4.00 loops=1)
  Group Key: status
  Buffers: shared hit=1 read=2
  ->  Index Only Scan using evaluation_by_cycle_status on evaluation (actual rows=199.00 loops=1)
        Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (cycle_id = '01a11965-d1cd-7ad4-a254-d1c7338c834d'::uuid))
        Heap Fetches: 0
        Index Searches: 1
        Buffers: shared hit=1 read=2
Planning:
  Buffers: shared hit=69 read=5
```

### scores: all scores of one evaluation
```
Index Scan using evaluation_score_tenant_id_evaluation_id_competency_id_eval_key on evaluation_score (actual rows=40.00 loops=1)
  Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (evaluation_id = '01a11965-d291-7c29-8129-e106a2ea55a8'::uuid))
  Index Searches: 1
  Buffers: shared hit=7 read=19
Planning:
  Buffers: shared hit=58 read=2
```
