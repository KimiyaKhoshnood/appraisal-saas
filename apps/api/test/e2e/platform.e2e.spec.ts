import { Harness, PASSWORD, uniqueSlug } from '../support/harness';

/** PL-01..PL-05, NF-11, T7, T8: tenant life-cycle as data. */
describe('platform: tenant life-cycle', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await Harness.start();
  });
  afterAll(() => h.close());

  it('creates a usable tenant with one API call, without restart, well under 5 s (NF-11)', async () => {
    const slug = uniqueSlug('fresh');
    const started = performance.now();
    const res = await h
      .platform()
      .post('/api/platform/tenants')
      .send({
        name: 'Fresh Co',
        slug,
        plan: 'BUSINESS',
        admin: { email: `boss@${slug}.test`, fullName: 'Fresh Boss', password: PASSWORD },
        branding: { appName: 'Fresh Reviews', logoUrl: 'https://example.com/logo.svg', primaryColor: '#0f766e', secondaryColor: '#1d4ed8', locale: 'en' },
        evaluationPolicy: { approvalRequired: true },
      })
      .expect(201);
    const session = await h.login(slug, `boss@${slug}.test`);
    const elapsed = performance.now() - started;
    expect(res.body.tenant.status).toBe('ACTIVE');
    expect(res.body.durationMs).toBeLessThan(5_000);
    expect(elapsed).toBeLessThan(5_000);

    const me = (await h.as(`${slug}.localhost`, session.token).get('/api/me/context').expect(200)).body;
    expect(me.branding.appName).toBe('Fresh Reviews');
    expect(me.features).toEqual(expect.arrayContaining(['reports', 'csvExport']));
    expect(me.policy.approvalRequired).toBe(true);
    // The tenant's own audit log shows who created it.
    const audit = (await h.as(`${slug}.localhost`, session.token).get('/api/audit').expect(200)).body.items;
    expect(audit.find((a: { action: string }) => a.action === 'platform.tenant.created')?.actor?.fullName).toBe('Test Platform');
  });

  it('is atomic: a failure half-way leaves nothing behind (PL-01)', async () => {
    const slug = uniqueSlug('atomic');
    const res = await h
      .platform()
      .post('/api/platform/tenants')
      .send({ name: 'Broken', slug, plan: 'STARTER', features: ['analytics'], admin: { email: `a@${slug}.test`, fullName: 'Aa Bb', password: PASSWORD } });
    expect(res.status).toBe(422); // analytics is not part of STARTER, detected inside the transaction
    const list = (await h.platform().get('/api/platform/tenants').expect(200)).body as { slug: string }[];
    expect(list.some((x) => x.slug === slug)).toBe(false);
    // ...so the slug is still free.
    await h
      .platform()
      .post('/api/platform/tenants')
      .send({ name: 'Fixed', slug, plan: 'STARTER', admin: { email: `a@${slug}.test`, fullName: 'Aa Bb', password: PASSWORD } })
      .expect(201);
  });

  it('validates slugs: reserved, malformed and duplicate', async () => {
    const base = { name: 'X Co', plan: 'STARTER', admin: { email: 'a@x.test', fullName: 'Aa Bb', password: PASSWORD } };
    expect((await h.platform().post('/api/platform/tenants').send({ ...base, slug: 'admin' })).status).toBe(400);
    expect((await h.platform().post('/api/platform/tenants').send({ ...base, slug: 'Bad_Slug' })).status).toBe(400);
    expect((await h.platform().post('/api/platform/tenants').send({ ...base, slug: 'a--b' })).status).toBe(400);
    const t = await h.createTenant();
    const dup = await h.platform().post('/api/platform/tenants').send({ ...base, slug: t.slug });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('SLUG_TAKEN');
  });

  it('suspension stops every request of the tenant at once; reactivation restores it (PL-02, T8)', async () => {
    const t = await h.createTenant();
    await h.as(t.host, t.adminToken).get('/api/me/context').expect(200);
    await h.platform().post(`/api/platform/tenants/${t.id}/suspend`).expect(200);

    const res = await h.as(t.host, t.adminToken).get('/api/me/context');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_SUSPENDED');
    await h.as(t.host).post('/api/auth/login').send({ email: t.adminEmail, password: PASSWORD }).expect(404);
    await h.as(t.host).get('/api/public/branding').expect(404);

    await h.platform().post(`/api/platform/tenants/${t.id}/activate`).expect(200);
    await h.as(t.host, t.adminToken).get('/api/me/context').expect(200);

    const platformAudit = (await h.platform().get('/api/platform/audit?limit=100').expect(200)).body.items.map((i: { action: string }) => i.action);
    expect(platformAudit).toEqual(expect.arrayContaining(['platform.tenant.suspended', 'platform.tenant.activated']));
  });

  it('the platform admin has no route to tenant evaluation data (T7, least privilege)', async () => {
    const t = await h.createTenant();
    const tenantRoutes = ['/api/evaluations', '/api/cycles', '/api/users', '/api/audit'];
    for (const path of tenantRoutes) {
      // On the tenant host: wrong token type.
      expect((await h.as(t.host, h.platformToken).get(path)).status).toBe(401);
      // On the admin host: still a tenant route, still the wrong token type.
      expect((await h.platform().get(path)).status).toBe(401);
    }
  });

  it('platform login: generic failure, refresh rotation on the admin host only', async () => {
    const bad = await h.as('admin.localhost').post('/api/platform/auth/login').send({ email: 'platform@test.test', password: 'wrong-pass-1' });
    expect(bad.status).toBe(401);
    const ok = await h.as('admin.localhost').post('/api/platform/auth/login').send({ email: 'platform@test.test', password: PASSWORD }).expect(200);
    const cookie = ([] as string[]).concat(ok.headers['set-cookie'] ?? []).find((c) => c.startsWith('prt='))!.split(';')[0]!;
    await h.as('admin.localhost').post('/api/platform/auth/refresh').set('Cookie', cookie).expect(200);
    await h.as('admin.localhost').post('/api/platform/auth/refresh').set('Cookie', cookie).expect(401); // replay
  });

  it('every route declares an access policy and is documented in OpenAPI', async () => {
    const doc = (await h.http().get('/api/openapi.json').expect(200)).body;
    const paths = Object.keys(doc.paths);
    expect(paths).toEqual(expect.arrayContaining(['/api/evaluations/{id}/approve', '/api/platform/tenants', '/api/auth/login']));
    const approve = doc.paths['/api/evaluations/{id}/approve'].post;
    expect(approve.security).toEqual([{ tenantBearer: [] }]);
    expect(approve.description).toMatch(/evaluation:approve/);
    const create = doc.paths['/api/platform/tenants'].post;
    expect(create.requestBody.content['application/json'].schema.additionalProperties).toBe(false);
  });

  it('health is public and cheap', async () => {
    expect((await h.http().get('/api/health').expect(200)).body).toEqual({ status: 'ok' });
  });
});
