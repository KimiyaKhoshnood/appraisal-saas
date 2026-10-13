import { RouteRegistry, type RouteInfo } from '../../src/core';
import { buildOrg, type Harness, type TenantHandle } from './harness';

/**
 * Experiment E1: the isolation matrix.
 *
 * Every tenant route is enumerated from the RouteRegistry (not from a hand-written list), then
 * attacked from tenant A with identifiers that belong to tenant B. A route added tomorrow is in
 * the matrix tomorrow; if it takes a body and has no sample below, the coverage test fails.
 */

const ANY_UUID = '01960000-0000-7000-8000-000000000000';

/** Minimal *valid* bodies so the request reaches the service (validation would answer 400 first). */
export const SAMPLE_BODIES: Record<string, (ctx: { ownRoleId: string }) => unknown> = {
  'PATCH /api/users/:id': () => ({ fullName: 'Hijacked Name' }),
  'PUT /api/users/:id/roles': ({ ownRoleId }) => ({ roleIds: [ownRoleId] }),
  // Account takeover attempt: setting the password of another tenant's user.
  'POST /api/users/:id/password': () => ({ password: 'Hijacked-pass-2026' }),
  'PATCH /api/roles/:id': () => ({ name: 'Hijacked role' }),
  'PATCH /api/org/departments/:id': () => ({ name: 'Hijacked department' }),
  'PUT /api/org/employees/:userId': () => ({ jobTitle: 'Hijacked title' }),
  'PUT /api/cycles/:id/competencies': () => ({ competencies: [{ name: 'Hijack', weight: 100 }] }),
  'PUT /api/evaluations/:id/self-scores': () => ({ scores: [{ competencyId: ANY_UUID, score: 3 }] }),
  'PUT /api/evaluations/:id/manager-scores': () => ({ scores: [{ competencyId: ANY_UUID, score: 3 }] }),
  'POST /api/evaluations/:id/self-submit': () => ({}),
  'POST /api/evaluations/:id/manager-submit': () => ({}),
  'POST /api/evaluations/:id/approve': () => ({ comment: 'approved by an attacker' }),
  'POST /api/evaluations/:id/reject': () => ({ reason: 'rejected by an attacker' }),
};

/** Which of B's resources a path parameter refers to, from the segment before it. */
function resourceFor(path: string, param: string): string {
  const segments = path.split('/');
  const idx = segments.indexOf(`:${param}`);
  return segments[idx - 1] ?? 'unknown';
}

export interface Victim {
  tenant: TenantHandle;
  ids: Record<string, string>;
  allIds: string[];
  snapshot: () => Promise<string>;
}

export async function buildVictim(h: Harness, b: TenantHandle): Promise<Victim> {
  const org = await buildOrg(h, b);
  const admin = h.as(b.host, b.adminToken);
  const role = (await admin.post('/api/roles').send({ name: 'Victim role', permissions: ['user:read'] }).expect(201)).body;
  const dept = (await admin.post('/api/org/departments').send({ name: 'Victim department' }).expect(201)).body;
  await admin.put(`/api/org/employees/${org.emp1.id}`).send({ departmentId: dept.id }).expect(200);
  const draft = (await admin.post('/api/cycles').send({ name: 'Victim draft', startsOn: '2026-10-01' }).expect(201)).body;
  const evaluationId = org.evalOf(org.emp1.id);
  const ids: Record<string, string> = {
    users: org.emp1.id,
    employees: org.emp1.id,
    roles: role.id,
    departments: dept.id,
    cycles: draft.id,
    evaluations: evaluationId,
  };
  const snapshot = async () =>
    JSON.stringify(
      await Promise.all([
        admin.get('/api/users?limit=100').then((r) => r.body),
        admin.get('/api/roles').then((r) => r.body),
        admin.get('/api/org/departments').then((r) => r.body),
        admin.get('/api/org/employees').then((r) => r.body),
        admin.get('/api/cycles').then((r) => r.body),
        admin.get(`/api/evaluations/${evaluationId}`).then((r) => r.body),
      ]),
    );
  return { tenant: b, ids, allIds: [b.id, b.adminId, org.manager.id, org.emp1.id, org.emp2.id, role.id, dept.id, draft.id, org.cycle.id, evaluationId], snapshot };
}

export function tenantRoutes(h: Harness): RouteInfo[] {
  return h.app.get(RouteRegistry).routes().filter((r) => r.access?.kind === 'tenant');
}

export interface MatrixRow {
  route: string;
  status: number;
  code: string | undefined;
}

/** Attack every parameterised tenant route of B from A. */
export async function attackWithForeignIds(h: Harness, attacker: TenantHandle, victim: Victim): Promise<MatrixRow[]> {
  const roles = (await h.as(attacker.host, attacker.adminToken).get('/api/roles').expect(200)).body as { id: string }[];
  const ownRoleId = roles[0]!.id;
  const rows: MatrixRow[] = [];
  for (const r of tenantRoutes(h).filter((x) => x.schemas.params?.length)) {
    let url = r.path;
    for (const p of r.schemas.params!) {
      const id = victim.ids[resourceFor(r.path, p)];
      if (!id) throw new Error(`No victim id for ${r.path} :${p}`);
      url = url.replace(`:${p}`, id);
    }
    const key = `${r.method} ${r.path}`;
    const req = h.as(attacker.host, attacker.adminToken).method(r.method, url);
    const sample = SAMPLE_BODIES[key];
    const res = sample ? await req.send(sample({ ownRoleId }) as object) : await req;
    rows.push({ route: key, status: res.status, code: res.body?.code });
  }
  return rows;
}

/** Every collection route of A must not mention a single identifier of B. */
export async function scanCollections(h: Harness, attacker: TenantHandle, victim: Victim): Promise<{ route: string; status: number; leaked: string[] }[]> {
  const out = [];
  for (const r of tenantRoutes(h).filter((x) => x.method === 'GET' && !x.schemas.params?.length)) {
    const res = await h.as(attacker.host, attacker.adminToken).get(r.path);
    const text = typeof res.text === 'string' ? res.text : JSON.stringify(res.body);
    out.push({ route: r.path, status: res.status, leaked: victim.allIds.filter((id) => text.includes(id)) });
  }
  return out;
}

/** References to B smuggled inside A's own writes (composite FKs + RLS must reject them). */
export async function injectForeignReferences(h: Harness, attacker: TenantHandle, victim: Victim) {
  const a = h.as(attacker.host, attacker.adminToken);
  const ownUser = (await a.get('/api/users?limit=1').expect(200)).body.items[0].id as string;
  return {
    roleOnCreate: (await a.post('/api/users').send({ email: 'x1@inject.test', fullName: 'Inj One', password: 'Inject-pass-1', roleIds: [victim.ids.roles] })).status,
    roleOnAssign: (await a.put(`/api/users/${ownUser}/roles`).send({ roleIds: [victim.ids.roles] })).status,
    foreignManager: (await a.put(`/api/org/employees/${ownUser}`).send({ managerId: victim.ids.users })).status,
    foreignDepartment: (await a.put(`/api/org/employees/${ownUser}`).send({ departmentId: victim.ids.departments })).status,
    foreignCycleFilter: (await a.get(`/api/evaluations?scope=all&cycleId=${victim.ids.cycles}`)).body.items?.length ?? -1,
  };
}
