# ADR-015: Per-tenant RED metrics with bounded cardinality

- Status: Accepted
- Date: 2026-10-13

## Problem
Experiment E4 showed that one heavy tenant can multiply another tenant's p95 latency. The
controls (rate limit, statement timeout) reduce the damage, but in operation someone has to
*see* which tenant is heavy, which is suffering and whether the limiter is firing. Logs carry
`tenantId` per line (NF-14) but answer "what is happening now" only with a query engine.

## Decision
- An Express middleware records every finished response (including 401/403/429 rejected by
  guards, which an interceptor would miss) as rate, errors and duration per tenant.
- **Bounded labels.** The tenant label is never combined with the route label: tenant series carry
  status class and latency histogram; route series carry the Express route *template*
  (`/api/evaluations/:id`, never an id) without tenant. At most 500 tenant series per instance,
  later tenants share `_other`; requests rejected before a tenant was known are `_none`.
- **Two consumers, one source.** `GET /api/metrics` serves the Prometheus text format (cumulative
  counters, a latency histogram with fixed buckets; replicas are summed by Prometheus). It needs
  its own bearer token, compared in constant time, and does not exist (404) when no token is
  configured, because tenant names are business data. The platform console reads
  `GET /api/platform/tenant-health`, a five-minute sliding window with p50/p95 computed like
  PromQL's `histogram_quantile`, and shows a health strip on every tenant card (red when 5xx or
  throttling, amber above the 250 ms p95 target).
- No dependency: the exposition format is a few lines of text; `prom-client` would also work.

## Alternatives
OpenTelemetry SDK + collector (the right step once there is a backend to send to; adds a
collector to the demo); metrics from logs (delayed, needs a log pipeline); labels
`tenant × route` (cardinality grows as tenants × routes; with 500 tenants and ~60 routes that is
150 000 series per status class).

## Consequences
The console view is per instance (each replica sees its share of the traffic); Prometheus is the
place for the fleet-wide view. Memory grows with tenants up to the cap, not with requests.

## Verification
`tenant-metrics.spec.ts` (quantile estimate, per-tenant errors and throttling, window expiry,
cardinality cap, exposition format, no tenant × route labels), `observability.e2e.spec.ts`
(token required, 404 otherwise; tenant and route-template labels with no ids; operator sees
tenants, tenants cannot), and a manual check of the console strip under generated traffic.
