import { Harness, PASSWORD, PLATFORM_HOST, hostOf, type TenantHandle } from '../support/harness';

/** AU-01..AU-03, NF-04, T5, T7, T13. */
describe('authentication and tenant resolution', () => {
  let h: Harness;
  let a: TenantHandle;
  let b: TenantHandle;

  beforeAll(async () => {
    h = await Harness.start();
    a = await h.createTenant();
    b = await h.createTenant();
  });
  afterAll(() => h.close());

  it('logs in on the tenant sub-domain and returns the context', async () => {
    const me = await h.as(a.host, a.adminToken).get('/api/me/context').expect(200);
    expect(me.body.tenant.slug).toBe(a.slug);
    expect(me.body.permissions).toContain('config:write');
  });

  it('the same e-mail is a different account in another tenant', async () => {
    // a's admin e-mail does not exist in b: login on b's host fails.
    const res = await h.as(b.host).post('/api/auth/login').send({ email: a.adminEmail, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('does not reveal whether an account exists (T13)', async () => {
    const wrongPassword = await h.as(a.host).post('/api/auth/login').send({ email: a.adminEmail, password: 'nope-nope-1' });
    const unknownUser = await h.as(a.host).post('/api/auth/login').send({ email: 'ghost@nowhere.test', password: 'nope-nope-1' });
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    const strip = ({ requestId: _r, ...rest }: Record<string, unknown>) => rest;
    expect(strip(wrongPassword.body)).toEqual(strip(unknownUser.body));
  });

  it('rejects requests without a token, with a garbage token and on an unknown host', async () => {
    await h.as(a.host).get('/api/me/context').expect(401);
    await h.as(a.host, 'not-a-jwt').get('/api/me/context').expect(401);
    await h.as('nope.localhost').post('/api/auth/login').send({ email: 'x@y.test', password: 'whatever-1' }).expect(404);
  });

  it("refuses tenant A's token on tenant B's sub-domain and records a security event (T5)", async () => {
    const res = await h.as(b.host, a.adminToken).get('/api/me/context').expect(403);
    expect(res.body.code).toBe('TENANT_MISMATCH');
    const audit = await h.as(a.host, a.adminToken).get('/api/audit?category=SECURITY').expect(200);
    expect(audit.body.items.map((i: { action: string }) => i.action)).toContain('security.tenant_host_mismatch');
  });

  it('separates platform and tenant identities (T7, ADR-005)', async () => {
    // Platform token on a tenant route: wrong key + audience.
    await h.as(a.host, h.platformToken).get('/api/me/context').expect(401);
    // Tenant token on a platform route.
    await h.as(PLATFORM_HOST, a.adminToken).get('/api/platform/tenants').expect(401);
    // Platform API on a tenant host.
    await h.as(a.host, h.platformToken).get('/api/platform/tenants').expect(403);
    // Platform login does not exist on tenant hosts.
    await h.as(a.host).post('/api/platform/auth/login').send({ email: 'platform@test.test', password: PASSWORD }).expect(404);
  });

  it('rotates refresh tokens and revokes the family when an old one is replayed (NF-04)', async () => {
    const s = await h.login(a.slug, a.adminEmail);
    const first = await h.as(a.host).post('/api/auth/refresh').set('Cookie', s.cookie).expect(200);
    const rotated = ([] as string[]).concat(first.headers['set-cookie'] ?? []).find((c) => c.startsWith('rt='))!.split(';')[0]!;
    expect(rotated).not.toBe(s.cookie);
    expect(first.body.accessToken).toBeTruthy();

    // Replay of the consumed token → 401 and the *new* token is revoked too.
    await h.as(a.host).post('/api/auth/refresh').set('Cookie', s.cookie).expect(401);
    await h.as(a.host).post('/api/auth/refresh').set('Cookie', rotated).expect(401);

    const audit = await h.as(a.host, a.adminToken).get('/api/audit?action=security.refresh_token_reuse').expect(200);
    expect(audit.body.items.length).toBeGreaterThan(0);
  });

  it("a refresh cookie of tenant A is useless on tenant B's host", async () => {
    const s = await h.login(a.slug, a.adminEmail);
    await h.as(b.host).post('/api/auth/refresh').set('Cookie', s.cookie).expect(401);
    // ...and still valid at home (it was not consumed by the failed attempt)
    await h.as(a.host).post('/api/auth/refresh').set('Cookie', s.cookie).expect(200);
  });

  it('logout ends the session family', async () => {
    const s = await h.login(a.slug, a.adminEmail);
    await h.as(a.host).post('/api/auth/logout').set('Cookie', s.cookie).expect(204);
    await h.as(a.host).post('/api/auth/refresh').set('Cookie', s.cookie).expect(401);
  });

  it('sets the refresh cookie httpOnly, SameSite=Strict, without Domain', async () => {
    const res = await h.as(a.host).post('/api/auth/login').send({ email: a.adminEmail, password: PASSWORD }).expect(200);
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('rt='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(res.body).not.toHaveProperty('refreshToken');
  });

  it('throttles brute force per tenant+ip+email (T13)', async () => {
    const t = await h.createTenant();
    const attempts = [];
    for (let i = 0; i < 6; i++) {
      attempts.push((await h.as(hostOf(t.slug)).post('/api/auth/login').send({ email: t.adminEmail, password: 'wrong-pass-1' })).status);
    }
    expect(attempts.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(attempts[5]).toBe(429);
  });
});
