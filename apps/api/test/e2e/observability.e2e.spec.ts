import { Harness, buildOrg, type TenantHandle } from '../support/harness';

const TOKEN = 'metrics-token-0123456789abcdef';

/** Per-tenant RED metrics: Prometheus scrape (own token) and the operator's tenant-health view. */
describe('per-tenant observability', () => {
  let h: Harness;
  let a: TenantHandle;
  let b: TenantHandle;

  beforeAll(async () => {
    h = await Harness.start({ METRICS_TOKEN: TOKEN });
    a = await h.createTenant();
    b = await h.createTenant();
    const org = await buildOrg(h, a);
    for (let i = 0; i < 5; i++) await h.as(a.host, org.emp1.token).get(`/api/evaluations/${org.evalOf(org.emp1.id)}`).expect(200);
    await h.as(b.host, b.adminToken).get('/api/users').expect(200);
    await h.as(a.host).get('/api/users').expect(401); // rejected before a tenant is known
  });
  afterAll(async () => {
    delete process.env.METRICS_TOKEN;
    await h.close();
  });

  const scrape = (auth?: string) => {
    const r = h.http().get('/api/metrics').set('Host', 'localhost');
    return auth ? r.set('Authorization', auth) : r;
  };

  it('the scrape endpoint needs its own token and answers 404 otherwise', async () => {
    await scrape().expect(404);
    await scrape('Bearer wrong-token-0123456789abcdef').expect(404);
    await scrape(`Bearer ${h.platformToken}`).expect(404);
    const res = await scrape(`Bearer ${TOKEN}`).expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain;.*version=0\.0\.4/);
  });

  it('labels by tenant and by route template, never by raw URL', async () => {
    const text = (await scrape(`Bearer ${TOKEN}`).expect(200)).text;
    const counter = (slug: string) => new RegExp(String.raw`appraisal_http_requests_total\{tenant="${slug}",status="2xx"\} \d+`);
    expect(text).toMatch(counter(a.slug));
    expect(text).toMatch(counter(b.slug));
    expect(text).toMatch(/appraisal_http_requests_total\{tenant="_none",status="4xx"\} \d+/);
    expect(text).toContain('route="/api/evaluations/:id"');
    expect(text).not.toMatch(/route="[^"]*[0-9a-f]{8}-[0-9a-f]{4}-/); // no ids in labels
  });

  it('the operator sees each tenant’s traffic; tenants cannot', async () => {
    const res = await h.platform().get('/api/platform/tenant-health').expect(200);
    const row = (res.body.tenants as { tenant: string; requests: number; p95Ms: number | null }[]).find((t) => t.tenant === a.slug);
    expect(row!.requests).toBeGreaterThanOrEqual(5);
    expect(row!.p95Ms).toBeGreaterThan(0);
    expect(res.body.windowMinutes).toBe(5);
    const denied = await h.as(a.host, a.adminToken).get('/api/platform/tenant-health');
    expect([401, 403, 404]).toContain(denied.status);
  });
});
