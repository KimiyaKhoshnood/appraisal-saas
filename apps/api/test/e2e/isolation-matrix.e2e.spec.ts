import { Harness, buildOrg, type TenantHandle } from '../support/harness';
import {
  SAMPLE_BODIES,
  attackWithForeignIds,
  buildVictim,
  injectForeignReferences,
  scanCollections,
  tenantRoutes,
  type Victim,
} from '../support/isolation-matrix';

/**
 * E1 (RQ1, RQ5, NF-01, T1, T2, T4, T11). Run twice: with every layer on, and with the Prisma
 * tenant filter (layer 2) switched off so that only RLS stands between the tenants.
 */
describe.each([
  { mode: 'all layers', appFilter: 'on' },
  { mode: 'RLS only (application filter off)', appFilter: 'off' },
])('isolation matrix: $mode', ({ appFilter }) => {
  let h: Harness;
  let a: TenantHandle;
  let victim: Victim;
  let before: string;
  let scans: Awaited<ReturnType<typeof scanCollections>>;

  beforeAll(async () => {
    h = await Harness.start({ TENANCY_APP_FILTER: appFilter });
    a = await h.createTenant();
    await buildOrg(h, a); // A has its own data, so every collection scan returns something
    victim = await buildVictim(h, await h.createTenant());
    before = await victim.snapshot();
    // Scanned before the attack: afterwards A's audit log legitimately echoes the foreign ids
    // A itself sent (security.resource_not_found), which is attacker input, not B's data.
    scans = await scanCollections(h, a, victim);
  });
  afterAll(async () => {
    process.env.TENANCY_APP_FILTER = 'on';
    await h.close();
  });

  it('covers every tenant route that takes a body (coverage guard)', () => {
    const missing = tenantRoutes(h)
      .filter((r) => r.schemas.params?.length && r.schemas.body)
      .map((r) => `${r.method} ${r.path}`)
      .filter((k) => !SAMPLE_BODIES[k]);
    expect(missing).toEqual([]);
  });

  it('answers 404 NOT_FOUND to every foreign identifier on every route', async () => {
    const rows = await attackWithForeignIds(h, a, victim);
    expect(rows.length).toBeGreaterThanOrEqual(20);
    const failures = rows.filter((r) => r.status !== 404 || r.code !== 'NOT_FOUND');
    expect(failures).toEqual([]);
  });

  it("never returns one of B's identifiers from any of A's collection routes", () => {
    expect(scans.length).toBeGreaterThanOrEqual(10);
    expect(scans.filter((s) => s.leaked.length)).toEqual([]);
    // Sanity: the scans actually returned data (feature-gated routes are on for ENTERPRISE).
    expect(scans.filter((s) => s.status !== 200)).toEqual([]);
  });

  it("rejects references to B's rows inside A's own writes", async () => {
    const r = await injectForeignReferences(h, a, victim);
    expect(r).toEqual({ roleOnCreate: 404, roleOnAssign: 404, foreignManager: 404, foreignDepartment: 404, foreignCycleFilter: 0 });
  });

  it("left every one of B's resources untouched", async () => {
    expect(await victim.snapshot()).toBe(before);
  });

  it('gives the same 404 for "does not exist" and "belongs to another tenant" (T11)', async () => {
    const admin = h.as(a.host, a.adminToken);
    const foreign = await admin.get(`/api/evaluations/${victim.ids.evaluations}`);
    const missing = await admin.get('/api/evaluations/01960000-0000-7000-8000-00000000abcd');
    const strip = ({ requestId: _r, ...rest }: Record<string, unknown>) => rest;
    expect(foreign.status).toBe(404);
    expect(strip(foreign.body)).toEqual(strip(missing.body));
  });

  it('records the probes as security events in the attacker tenant (AD-02)', async () => {
    const res = await h.as(a.host, a.adminToken).get('/api/audit?action=security.resource_not_found&limit=100').expect(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(10);
  });
});
