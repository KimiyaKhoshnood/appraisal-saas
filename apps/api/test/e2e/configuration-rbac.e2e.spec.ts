import { Harness, buildOrg, type TenantHandle } from '../support/harness';

/** TA-01..TA-08, FE-01/FE-02, NF-05, T4, T6: configuration as data, RBAC as data. */
describe('configuration and role-based access', () => {
  let h: Harness;
  let t: TenantHandle;
  let org: Awaited<ReturnType<typeof buildOrg>>;

  beforeAll(async () => {
    h = await Harness.start();
    t = await h.createTenant({ plan: 'BUSINESS', features: ['reports'] });
    org = await buildOrg(h, t);
  });
  afterAll(() => h.close());

  const admin = () => h.as(t.host, t.adminToken);

  it('serves public branding before login, and nothing else', async () => {
    const res = await h.as(t.host).get('/api/public/branding').expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['appName', 'locale', 'logoUrl', 'primaryColor', 'secondaryColor', 'tenantName']);
  });

  it('applies a branding change on the very next request (versioned cache, FE-01)', async () => {
    const branding = { appName: 'Rebranded', logoUrl: null, primaryColor: '#7c2d12', secondaryColor: '#065f46', locale: 'fa' };
    await admin().put('/api/config/branding').send(branding).expect(200);
    const me = (await admin().get('/api/me/context').expect(200)).body;
    expect(me.branding).toEqual(branding);
    const audit = (await admin().get('/api/audit?action=config.branding.updated').expect(200)).body.items[0];
    expect(audit.metadata.changed).toEqual(expect.arrayContaining(['appName', 'primaryColor', 'locale']));
  });

  it('refuses a primary colour that makes text unreadable (WCAG 4.5:1)', async () => {
    const res = await admin()
      .put('/api/config/branding')
      .send({ appName: 'Unreadable', logoUrl: null, primaryColor: '#9ca3af', secondaryColor: '#065f46', locale: 'en' });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].path).toBe('primaryColor');
  });

  it('rejects unknown fields such as tenantId (mass assignment, NF-05/T4)', async () => {
    const res = await admin().post('/api/org/departments').send({ name: 'Smuggle', tenantId: '01960000-0000-7000-8000-000000000000' });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].message).toMatch(/tenantId/);
    const user = await admin().patch(`/api/users/${org.emp1.id}`).send({ fullName: 'Ok Name', active: false });
    expect(user.status).toBe(400);
  });

  it('feature gate: an off feature is a 404, on is 200; plan bounds the toggles (TA-05)', async () => {
    await admin().get('/api/reports/summary').expect(200);
    await admin().get('/api/analytics/overview').expect(404); // not in BUSINESS
    await admin().put('/api/config/features').send({ reports: false }).expect(200);
    await admin().get('/api/reports/summary').expect(404);
    const nav = (await admin().get('/api/me/context').expect(200)).body.features;
    expect(nav).not.toContain('reports');
    const res = await admin().put('/api/config/features').send({ analytics: true });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('FEATURE_NOT_ALLOWED');
    await admin().put('/api/config/features').send({ reports: true }).expect(200);
  });

  it('a plan upgrade by the platform widens what the tenant may enable', async () => {
    await h.platform().put(`/api/platform/tenants/${t.id}/plan`).send({ plan: 'ENTERPRISE' }).expect(200);
    await admin().put('/api/config/features').send({ analytics: true }).expect(200);
    await admin().get('/api/analytics/overview').expect(200);
    await h.platform().put(`/api/platform/tenants/${t.id}/plan`).send({ plan: 'BUSINESS' }).expect(200);
    // Downgrade: the feature row stays on but the plan intersection hides it.
    await admin().get('/api/analytics/overview').expect(404);
  });

  it('an employee is denied admin routes with 403 and each denial is audited (T6)', async () => {
    const emp = h.as(t.host, org.emp1.token);
    const denied = [
      emp.get('/api/users'),
      emp.post('/api/users').send({ email: 'x@x.test', fullName: 'Xx Yy', password: 'Password-123' }),
      emp.put('/api/config/branding').send({}),
      emp.get('/api/audit'),
      emp.post('/api/cycles').send({ name: 'Nope', startsOn: '2026-01-01' }),
      emp.get('/api/team/dashboard'),
    ];
    for (const r of await Promise.all(denied)) expect(r.status).toBe(403);
    const audit = (await admin().get('/api/audit?action=security.permission_denied&limit=100').expect(200)).body.items;
    expect(audit.length).toBeGreaterThanOrEqual(6);
  });

  it('role changes apply on the next request without re-login (ADR-007)', async () => {
    const emp = h.as(t.host, org.emp1.token);
    await emp.get('/api/users').expect(403);
    const roles = (await admin().get('/api/roles').expect(200)).body as { id: string; systemKey: string }[];
    const adminRole = roles.find((r) => r.systemKey === 'TENANT_ADMIN')!.id;
    await admin().put(`/api/users/${org.emp1.id}/roles`).send({ roleIds: [adminRole] }).expect(200);
    await emp.get('/api/users').expect(200); // same token, new permissions
    const employeeRole = roles.find((r) => r.systemKey === 'EMPLOYEE')!.id;
    await admin().put(`/api/users/${org.emp1.id}/roles`).send({ roleIds: [employeeRole] }).expect(200);
    await emp.get('/api/users').expect(403);
  });

  it('deactivating a user locks them out immediately, sessions included', async () => {
    const victim = await h.addUser(t, 'leaver', ['EMPLOYEE'], org.manager.id);
    const session = await h.login(t.slug, victim.email);
    await h.as(t.host, victim.token).get('/api/me/context').expect(200);
    await admin().post(`/api/users/${victim.id}/deactivate`).expect(200);
    await h.as(t.host, victim.token).get('/api/me/context').expect(401);
    await h.as(t.host).post('/api/auth/refresh').set('Cookie', session.cookie).expect(401);
    // An admin cannot lock themselves out.
    expect((await admin().post(`/api/users/${t.adminId}/deactivate`)).body.code).toBe('CANNOT_DEACTIVATE_SELF');
  });

  it('custom roles are data: create, assign, use, protected system roles (TA-08)', async () => {
    const enterprise = await h.createTenant({ plan: 'ENTERPRISE' });
    const a = h.as(enterprise.host, enterprise.adminToken);
    const role = (await a.post('/api/roles').send({ name: 'Auditor', permissions: ['audit:read', 'user:read'] }).expect(201)).body;
    expect((await a.post('/api/roles').send({ name: 'Bad', permissions: ['root:everything'] })).status).toBe(400);
    const auditor = await h.addUser(enterprise, 'auditor', []);
    await a.put(`/api/users/${auditor.id}/roles`).send({ roleIds: [role.id] }).expect(200);
    await h.as(enterprise.host, auditor.token).get('/api/audit').expect(200);
    await h.as(enterprise.host, auditor.token).get('/api/cycles').expect(403);
    const system = ((await a.get('/api/roles').expect(200)).body as { id: string; systemKey: string }[]).find((r) => r.systemKey === 'EMPLOYEE')!;
    expect((await a.patch(`/api/roles/${system.id}`).send({ name: 'Renamed' })).body.code).toBe('SYSTEM_ROLE_READONLY');
    // customRoles is not in BUSINESS: the same route does not exist there.
    await admin().post('/api/roles').send({ name: 'Auditor', permissions: ['audit:read'] }).expect(404);
  });

  it('organisation: departments and reporting lines without loops (TA-03)', async () => {
    const res = await admin().put(`/api/org/employees/${org.manager.id}`).send({ managerId: org.emp1.id });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('REPORTING_CYCLE');
    const dept = (await admin().post('/api/org/departments').send({ name: 'Research' }).expect(201)).body;
    await admin().put(`/api/org/employees/${org.emp2.id}`).send({ departmentId: dept.id, jobTitle: 'Researcher' }).expect(200);
    expect((await admin().delete(`/api/org/departments/${dept.id}`)).body.code).toBe('DEPARTMENT_NOT_EMPTY');
    const employees = (await admin().get('/api/org/employees').expect(200)).body as { userId: string; department: { name: string } | null }[];
    expect(employees.find((e) => e.userId === org.emp2.id)?.department?.name).toBe('Research');
  });

  it('every API error is RFC 9457 problem+json with a request id', async () => {
    const res = await admin().get('/api/users/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', title: 'Bad Request' });
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });
});
