import { Client } from 'pg';
import { Database, EventBus, TenantContext, MissingTenantContextError, loadEnv } from '../../src/core';
import { Harness, buildOrg, type TenantHandle } from '../support/harness';

/**
 * Database-level guarantees, tested with raw connections as the runtime role (no application
 * code in the way): NF-02, NF-03, T3, T12, T14 and E1 v3 ("raw query without context").
 */
describe('row-level security at the database', () => {
  let h: Harness;
  let a: TenantHandle;
  let b: TenantHandle;
  let runtime: Client;

  beforeAll(async () => {
    h = await Harness.start();
    a = await h.createTenant();
    b = await h.createTenant();
    await buildOrg(h, a);
    await buildOrg(h, b);
    runtime = new Client({ connectionString: process.env.DATABASE_URL });
    await runtime.connect();
  });
  afterAll(async () => {
    await runtime.end();
    await h.close();
  });

  const tenantTables = async (): Promise<string[]> =>
    (
      await runtime.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'tenant_id'
            AND table_name <> 'tenant_directory'`,
      )
    ).rows.map((r) => r.table_name);

  it('every table with a tenant_id column has FORCE RLS and a tenant policy (guards future tables)', async () => {
    const tables = await tenantTables();
    expect(tables.length).toBeGreaterThanOrEqual(17);
    const res = await runtime.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; policies: number }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1)`,
      [tables],
    );
    const unprotected = res.rows.filter((r) => !r.relrowsecurity || !r.relforcerowsecurity || r.policies !== 1).map((r) => r.relname);
    expect(unprotected).toEqual([]);
  });

  it('the runtime role is not superuser, cannot bypass RLS and owns no table (NF-03, T14)', async () => {
    const role = await runtime.query(`SELECT rolsuper, rolbypassrls, rolcreaterole FROM pg_roles WHERE rolname = current_user`);
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false });
    const owned = await runtime.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user`);
    expect(owned.rows).toEqual([]);
    const inherited = await runtime.query(
      `SELECT r.rolname FROM pg_roles r WHERE pg_has_role(current_user, r.oid, 'MEMBER') AND (r.rolbypassrls OR r.rolsuper)`,
    );
    expect(inherited.rows).toEqual([]);
  });

  it('without a tenant setting every tenant table returns zero rows (fail closed, NF-02 / E1 v3)', async () => {
    for (const table of await tenantTables()) {
      const res = await runtime.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect({ table, n: res.rows[0].n }).toEqual({ table, n: 0 });
    }
  });

  it('with a tenant setting only that tenant is visible, inside the transaction only', async () => {
    await runtime.query('BEGIN');
    await runtime.query(`SELECT set_config('app.tenant_id', $1, true)`, [a.id]);
    const visible = await runtime.query(`SELECT DISTINCT tenant_id FROM app_user`);
    await runtime.query('COMMIT');
    expect(visible.rows).toEqual([{ tenant_id: a.id }]);
    // The setting was transaction-local: gone after COMMIT (no leak to the next user of the connection).
    const after = await runtime.query(`SELECT current_setting('app.tenant_id', true) AS v, (SELECT count(*)::int FROM app_user) AS n`);
    expect(after.rows[0]).toEqual({ v: '', n: 0 });
  });

  it('cannot write a row for another tenant than the one in the setting (WITH CHECK)', async () => {
    await runtime.query('BEGIN');
    await runtime.query(`SELECT set_config('app.tenant_id', $1, true)`, [a.id]);
    await expect(
      runtime.query(`INSERT INTO department (tenant_id, name) VALUES ($1, 'smuggled')`, [b.id]),
    ).rejects.toThrow(/row-level security/);
    await runtime.query('ROLLBACK');
  });

  it('composite foreign keys forbid cross-tenant references even with direct SQL', async () => {
    const bRole = await (async () => {
      await runtime.query('BEGIN');
      await runtime.query(`SELECT set_config('app.tenant_id', $1, true)`, [b.id]);
      const r = await runtime.query<{ id: string }>(`SELECT id FROM role LIMIT 1`);
      await runtime.query('COMMIT');
      return r.rows[0]!.id;
    })();
    await runtime.query('BEGIN');
    await runtime.query(`SELECT set_config('app.tenant_id', $1, true)`, [a.id]);
    // tenant_id = A satisfies RLS, but (A, B's role id) does not exist: FK violation.
    await expect(
      runtime.query(`INSERT INTO user_role (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`, [a.id, a.adminId, bRole]),
    ).rejects.toThrow(/foreign key/);
    await runtime.query('ROLLBACK');
  });

  it('audit records cannot be updated, deleted or truncated (AD-03, T12)', async () => {
    await runtime.query('BEGIN');
    await runtime.query(`SELECT set_config('app.tenant_id', $1, true)`, [a.id]);
    await expect(runtime.query(`UPDATE audit_log SET action = 'forged'`)).rejects.toThrow(/permission denied/);
    await runtime.query('ROLLBACK');
    await runtime.query('BEGIN');
    await runtime.query(`SELECT set_config('app.tenant_id', $1, true)`, [a.id]);
    await expect(runtime.query(`DELETE FROM audit_log`)).rejects.toThrow(/permission denied/);
    await runtime.query('ROLLBACK');
    await expect(runtime.query(`TRUNCATE audit_log`)).rejects.toThrow(/permission denied/);

    // Even the owner (migrator) is stopped by the append-only trigger.
    const owner = new Client({ connectionString: process.env.MIGRATOR_DATABASE_URL });
    await owner.connect();
    try {
      await owner.query('BEGIN');
      await owner.query(`SELECT set_config('app.tenant_id', $1, true)`, [a.id]);
      await expect(owner.query(`UPDATE audit_log SET action = 'forged'`)).rejects.toThrow(/append-only/);
      await owner.query('ROLLBACK');
    } finally {
      await owner.end();
    }
  });

  it('the tenant slug is immutable at the database level', async () => {
    await expect(runtime.query(`UPDATE tenant SET slug = 'renamed-slug' WHERE id = $1`, [a.id])).rejects.toThrow(/immutable/);
  });

  it('the application layer refuses tenant models without a context (layer 1)', async () => {
    const db = h.app.get(Database);
    await expect(TenantContext.runPlatform({ type: 'SYSTEM', id: null, name: null }, () => db.client.user.findMany())).rejects.toBeInstanceOf(
      MissingTenantContextError,
    );
  });

  it('never leaks context between concurrent requests on a shared pool (T3)', async () => {
    const db = h.app.get(Database);
    const actor = { type: 'SYSTEM' as const, id: null, name: null };
    const tenants = [a.id, b.id];
    const results = await Promise.all(
      Array.from({ length: 200 }, (_, i) => {
        const tenantId = tenants[i % 2]!;
        return TenantContext.runAs(tenantId, actor, async () => {
          // Mix single operations and interactive transactions on the same pool.
          const rows =
            i % 3 === 0
              ? await db.transaction((tx) => tx.user.findMany({ select: { tenantId: true } }))
              : await db.client.user.findMany({ select: { tenantId: true } });
          return { expected: tenantId, seen: [...new Set(rows.map((r) => r.tenantId))] };
        });
      }),
    );
    const wrong = results.filter((r) => r.seen.length !== 1 || r.seen[0] !== r.expected);
    expect(wrong).toEqual([]);
  });

  it('runs everything inside one transaction on one connection, even lazily returned promises', async () => {
    // With a single pooled connection, any accidental second connection inside a transaction
    // would wait forever (deadlock) instead of passing silently.
    const single = new Database(loadEnv({ ...process.env, DB_POOL_MAX: '1' }));
    const actor = { type: 'SYSTEM' as const, id: null, name: null };
    try {
      const out = await TenantContext.runAs(a.id, actor, async () => {
        const lazy = await single.transaction((tx) => tx.user.findMany({ select: { id: true } }));
        const nested = await single.transaction(async () => {
          const n = await single.client.user.count();
          return single.transaction(async (tx) => n + (await tx.role.count()));
        });
        return { lazy: lazy.length, nested };
      });
      expect(out.lazy).toBeGreaterThan(0);
      expect(out.nested).toBeGreaterThan(out.lazy);
    } finally {
      await single.onModuleDestroy();
    }
  }, 20_000);

  it('rolls back the change and its audit record together (ADR-009)', async () => {
    const db = h.app.get(Database);
    const events = h.app.get(EventBus);
    const actor = { type: 'SYSTEM' as const, id: null, name: null };
    let doomedId = '';
    await TenantContext.runAs(a.id, actor, async () => {
      await expect(
        db.transaction(async (tx) => {
          const d = await tx.department.create({ data: { tenantId: a.id, name: 'Doomed department' } });
          doomedId = d.id;
          await events.publish({ type: 'org.department.created', category: 'CHANGE', entityType: 'department', entityId: d.id });
          // The audit row exists inside the transaction...
          expect(await tx.auditLog.count({ where: { entityId: d.id } })).toBe(1);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      // ...and neither it nor the department survives the rollback.
      expect(doomedId).not.toBe('');
      expect(await db.client.department.count({ where: { id: doomedId } })).toBe(0);
      expect(await db.client.auditLog.count({ where: { entityId: doomedId } })).toBe(0);
    });
  });
});
