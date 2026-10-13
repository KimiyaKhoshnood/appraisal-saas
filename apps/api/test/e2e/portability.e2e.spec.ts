import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { Database, TenantContext, TenantExportRegistry } from '../../src/core';
import { syncCatalog } from '../../prisma/sync-catalog';
import { Harness, buildOrg, scoresFor, type TenantHandle } from '../support/harness';

interface ExportBody {
  format: string;
  tenantId: string;
  tenant: { slug: string };
  snapshot: { isolation: string; readOnly: boolean };
  manifest: { section: string; rows: number; sha256: string }[];
  data: Record<string, Record<string, unknown>[]>;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** Tenant data portability: complete, isolated by RLS alone, consistent, audited, secret-free. */
describe('tenant data export', () => {
  let h: Harness;
  let a: TenantHandle;
  let b: TenantHandle;
  let orgA: Awaited<ReturnType<typeof buildOrg>>;
  let runtime: Client;

  beforeAll(async () => {
    h = await Harness.start();
    a = await h.createTenant();
    b = await h.createTenant();
    orgA = await buildOrg(h, a);
    const orgB = await buildOrg(h, b);
    // Give both tenants scores, so the export covers every evaluation table.
    for (const [t, org] of [
      [a, orgA],
      [b, orgB],
    ] as const) {
      await h
        .as(t.host, org.emp1.token)
        .put(`/api/evaluations/${org.evalOf(org.emp1.id)}/self-scores`)
        .send(scoresFor(org.competencies, 4))
        .expect(200);
    }
    runtime = new Client({ connectionString: process.env.DATABASE_URL });
    await runtime.connect();
  });
  afterAll(async () => {
    await runtime.end();
    await h.close();
  });

  const exportOf = async (t: TenantHandle) => (await h.as(t.host, t.adminToken).get('/api/tenant/export').expect(200)).body as ExportBody;

  it('is a downloadable, read-only snapshot with a verifiable manifest', async () => {
    const res = await h.as(a.host, a.adminToken).get('/api/tenant/export').expect(200);
    expect(res.headers['content-disposition']).toMatch(new RegExp(`attachment; filename="${a.slug}-export-\\d{4}-\\d{2}-\\d{2}\\.json"`));
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.body as ExportBody;
    expect(body.format).toBe('appraisal-tenant-export');
    expect(body.snapshot).toEqual({ isolation: 'REPEATABLE READ', readOnly: true });
    for (const m of body.manifest) {
      const table = m.section.split('.')[1]!;
      expect(body.data[table]).toHaveLength(m.rows);
      expect(createHash('sha256').update(JSON.stringify(body.data[table])).digest('hex')).toBe(m.sha256);
    }
    expect(body.data['app_user']!.length).toBe(4); // admin, manager, two employees
    expect(body.data['evaluation_score']!.length).toBeGreaterThan(0);
  });

  it('contains only the exporting tenant: every row, and not one identifier of the other tenant', async () => {
    const [ea, eb] = [await exportOf(a), await exportOf(b)];
    for (const rows of Object.values(ea.data)) for (const r of rows) expect(r['tenant_id']).toBe(a.id);
    const idsOf = (e: ExportBody) => new Set(JSON.stringify(e.data).match(UUID));
    const shared = [...idsOf(ea)].filter((id) => idsOf(eb).has(id));
    // The one legitimate overlap: the platform operator who created both tenants appears as the
    // actor of each tenant's own "tenant created" audit entry. No tenant-owned identifier is shared.
    const platformActors = new Set(ea.data['audit_log']!.filter((r) => r['actor_type'] === 'PLATFORM_ADMIN').map((r) => r['actor_id']));
    expect(shared.filter((id) => !platformActors.has(id))).toEqual([]);
  });

  it('never contains secrets: no password hash, no refresh token', async () => {
    const e = await exportOf(a);
    const text = JSON.stringify(e);
    expect(text).not.toMatch(/password_hash|\$argon2/);
    expect(e.data['refresh_token']).toBeUndefined();
  });

  it('covers every tenant table: a new table must be exported or excluded on purpose', async () => {
    const { rows } = await runtime.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity`,
    );
    const excluded = new Set(['refresh_token', 'tenant_authz_state']); // session secrets; internal cache counter
    const registered = new Set(h.app.get(TenantExportRegistry).registered().map((s) => s.table));
    for (const { relname } of rows) expect(registered.has(relname) || excluded.has(relname), relname).toBe(true);
    expect(registered.size + excluded.size).toBe(rows.length);
  });

  it('is denied to anyone without data:export, and the denial is a 403', async () => {
    await h.as(a.host, orgA.manager.token).get('/api/tenant/export').expect(403);
    await h.as(a.host, orgA.emp1.token).get('/api/tenant/export').expect(403);
  });

  it('is audited as a security event with counts and digest only', async () => {
    await exportOf(a);
    const entry = (await h.as(a.host, a.adminToken).get('/api/audit?action=data.exported').expect(200)).body.items[0];
    expect(entry.category).toBe('SECURITY');
    expect(Object.keys(entry.metadata).sort()).toEqual(['manifestSha256', 'rows', 'sections']);
  });

  it('runs in a transaction PostgreSQL itself keeps read-only', async () => {
    const db = h.app.get(Database);
    const attempt = TenantContext.runAs(a.id, { type: 'SYSTEM', id: null, name: null }, () =>
      db.transaction((tx) => tx.$executeRaw`UPDATE department SET name = name`, { readOnly: true }),
    );
    await expect(attempt).rejects.toThrow(/read-only transaction/);
  });

  it('a permission added to a system role reaches existing tenants on the next catalog sync', async () => {
    const migrator = new Client({ connectionString: process.env.MIGRATOR_DATABASE_URL });
    await migrator.connect();
    try {
      // Simulate a tenant created before `data:export` existed.
      await migrator.query('BEGIN');
      await migrator.query(`SELECT set_config('app.tenant_id', $1, true)`, [b.id]);
      await migrator.query(`DELETE FROM role_permission WHERE permission_key = 'data:export'`);
      await migrator.query('UPDATE tenant_authz_state SET version = version + 1');
      await migrator.query('COMMIT');
    } finally {
      await migrator.end();
    }
    await h.as(b.host, b.adminToken).get('/api/tenant/export').expect(403);
    expect(await syncCatalog(process.env.MIGRATOR_DATABASE_URL!)).toMatch(/[1-9]\d* system-role grants added/);
    await h.as(b.host, b.adminToken).get('/api/tenant/export').expect(200);
    // Idempotent: nothing left to add.
    expect(await syncCatalog(process.env.MIGRATOR_DATABASE_URL!)).toMatch(/; 0 system-role grants added/);
  });
});
