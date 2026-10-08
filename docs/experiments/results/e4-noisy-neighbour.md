# E4: noisy neighbour

_2026-10-08T03:16:28.688Z · 13th Gen Intel(R) Core(TM) i5-13420H (12 logical cores, 32 GB) · win32 10.0.22621 · Node v24.14.0 · PostgreSQL 18.3. PostgreSQL and the client on the same laptop (loopback); relative comparisons only._

Light tenant: 20 employees, ≈ 40 req/s of everyday reads (context, team list, cycles).
Heavy tenant: 2000 employees (100×), 24 concurrent clients calling the reports, analytics
and full-list endpoints back-to-back. Same API process, same 10-connection pool, same database.
20 s per scenario, a fresh application per scenario, 3 interleaved repetitions; medians across
repetitions, latencies in ms.

|  | scenario | light median | light p95 | p95 range over runs | p95 vs alone | light status codes (all runs) | heavy 200/s | heavy status codes (all runs) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S0 | light tenant alone | 15.3 | 27.1 | 23–27 | 1× | 200:1234 | 0 |  |
| S1 | heavy load, no controls | 256.2 | 959.7 | 855–1011 | 35.4× | 200:150 | 19.1 | 200:1165 |
| S2 | heavy load + per-tenant rate limit (600/min) | 106.8 | 683 | 529–875 | 25.2× | 200:276 | 15 | 200:897 429:5962 |
| S3 | heavy load + rate limit + statement_timeout 150 ms | 140.1 | 297.7 | 240–712 | 11× | 200:314 | 10.2 | 200:606 429:9662 503:297 |

## Reading

- **S1 shows the price of shared resources**: with no controls the heavy tenant occupies the
  10-connection pool and the CPU, and the light tenant's p95 grows by one to two orders of
  magnitude. The spread between repetitions is large: contention is bursty.
- **S2, per-tenant rate limit**: the heavy tenant's excess is answered with a cheap 429 before it
  reaches the database, and the light tenant's latency falls substantially. (The first version of
  the limiter allowed a burst of a full minute's budget and did not fire within a 20 s run; the
  burst is now ten seconds' worth.)
- **S3, plus statement_timeout**: expensive statements are cut after 150 ms and answered 503 +
  Retry-After, so no single query holds a connection for long; the light tenant's tail improves
  further.
- **Not solved**: even with both controls the light tenant stays well above its stand-alone
  latency, because the heavy tenant's *permitted* share still competes for the same pool and CPU.
  Fully isolating a heavy tenant needs separate capacity: a per-tenant connection budget or
  moving it to its own database through `tenant_directory`, the documented growth path.
- The limiter is in-memory per instance: with R replicas the effective budget is R × the
  configured one, accepted until exact limits are required (Redis).
