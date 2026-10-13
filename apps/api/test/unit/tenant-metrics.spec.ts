import { MAX_TENANTS, TenantMetrics, UNATTRIBUTED } from '../../src/core';

const T0 = Date.UTC(2026, 9, 13, 12, 0, 0);
const req = (tenant: string | null, seconds: number, status = 200, at = T0) => ({ tenant, method: 'GET', route: '/api/x/:id', status, seconds, at });

describe('per-tenant metrics', () => {
  it('estimates quantiles like PromQL histogram_quantile', () => {
    const m = new TenantMetrics();
    // 90 fast (≤ 5 ms) and 10 slow (between 250 ms and 500 ms) requests.
    for (let i = 0; i < 90; i++) m.observe(req('acme', 0.002));
    for (let i = 0; i < 10; i++) m.observe(req('acme', 0.3));
    const [h] = m.health(T0);
    expect(h!.requests).toBe(100);
    expect(h!.p50Ms).toBeLessThanOrEqual(5);
    // rank 95 lies half-way into the (0.25, 0.5] bucket → 375 ms.
    expect(h!.p95Ms).toBe(375);
  });

  it('separates tenants and counts 5xx and 429 per tenant', () => {
    const m = new TenantMetrics();
    m.observe(req('acme', 0.01, 200));
    m.observe(req('acme', 0.01, 503));
    m.observe(req('globex', 0.01, 429));
    const byTenant = Object.fromEntries(m.health(T0).map((h) => [h.tenant, h]));
    expect(byTenant['acme']!.errorRate).toBe(0.5);
    expect(byTenant['globex']!.throttled).toBe(1);
    expect(byTenant['globex']!.errorRate).toBe(0);
  });

  it('forgets traffic older than the five-minute window', () => {
    const m = new TenantMetrics();
    m.observe(req('acme', 0.01, 200, T0));
    m.observe(req('acme', 0.01, 200, T0 + 10 * 60_000));
    expect(m.health(T0 + 10 * 60_000)[0]!.requests).toBe(1);
  });

  it('bounds cardinality: requests without a tenant and beyond the cap share a label', () => {
    const m = new TenantMetrics();
    m.observe(req(null, 0.01, 401));
    for (let i = 0; i < MAX_TENANTS + 20; i++) m.observe(req(`t${i}`, 0.01));
    const labels = m.health(T0).map((h) => h.tenant);
    expect(labels).toContain(UNATTRIBUTED);
    expect(labels).toContain('_other');
    expect(labels.length).toBe(MAX_TENANTS + 1);
  });

  it('writes the Prometheus text format with cumulative buckets and no tenant × route product', () => {
    const m = new TenantMetrics();
    m.observe(req('acme', 0.002));
    m.observe(req('acme', 0.3));
    const text = m.exposition();
    expect(text).toContain('# TYPE appraisal_http_request_duration_seconds histogram');
    expect(text).toContain('appraisal_http_request_duration_seconds_bucket{tenant="acme",le="0.005"} 1');
    expect(text).toContain('appraisal_http_request_duration_seconds_bucket{tenant="acme",le="0.5"} 2');
    expect(text).toContain('appraisal_http_request_duration_seconds_bucket{tenant="acme",le="+Inf"} 2');
    expect(text).toContain('appraisal_http_route_requests_total{method="GET",route="/api/x/:id",status="2xx"} 2');
    expect(text).not.toMatch(/tenant="[^"]*",[^}]*route=|route="[^"]*",[^}]*tenant=/);
    expect(text.endsWith('\n')).toBe(true);
  });
});
