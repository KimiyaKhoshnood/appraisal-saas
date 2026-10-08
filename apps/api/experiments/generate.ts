/**
 * Synthetic data for the experiments, generated set-based in SQL (seconds, not hours).
 *
 * Shape (assumption from the architecture document, made explicit so it can be criticised):
 * each tenant has U employees in groups of 10 under a manager, C cycles, K competencies, two
 * evaluators (SELF, MANAGER): U × C × K × 2 score rows per tenant.
 *
 * Bulk load runs as the table owner with FORCE ROW LEVEL SECURITY lifted for the duration of the
 * load, in the bench database only; FORCE is restored (and verified) before measuring.
 */
import { hashPassword } from '../src/core/security/passwords';
import { resetDatabase } from '../scripts/reset-db';
import { BENCH_DB, connect } from './lib';

export interface Shape {
  tenants: number;
  users: number;
  cycles: number;
  competencies: number;
  /** Extra employees for tenant #1 (noisy-neighbour experiments); 0 = uniform. */
  heavyUsers?: number;
  auditPerTenant?: number;
}

export const TENANT_TABLES = [
  'tenant_settings', 'tenant_authz_state', 'tenant_feature', 'tenant_branding', 'app_user', 'role', 'role_permission',
  'user_role', 'refresh_token', 'department', 'employee_profile', 'evaluation_cycle', 'competency', 'evaluation',
  'evaluation_score', 'approval_record', 'audit_log',
];

export const BENCH_PASSWORD = 'Bench-pass-2026';

export async function generate(shape: Shape): Promise<{ seconds: number; rows: Record<string, number> }> {
  const started = performance.now();
  await resetDatabase({ database: BENCH_DB, quiet: true });
  const db = await connect('migrator');
  const hash = await hashPassword(BENCH_PASSWORD);
  const policy = JSON.stringify({
    cycle: 'QUARTERLY',
    scale: { min: 1, max: 5 },
    selfAssessmentRequired: true,
    approvalRequired: false,
    approvalStrategy: 'SINGLE',
    resultVisibility: 'AFTER_PUBLISH',
  });
  try {
    for (const t of TENANT_TABLES) await db.query(`ALTER TABLE ${t} NO FORCE ROW LEVEL SECURITY`);
    const q = (sql: string, params: unknown[] = []) => db.query(sql, params);

    await q(`INSERT INTO tenant (name, slug, plan_code, status, updated_at)
             SELECT 'Bench ' || g, 'bench-' || g, 'ENTERPRISE', 'ACTIVE', now() FROM generate_series(1, $1) g`, [shape.tenants]);
    await q(`INSERT INTO tenant_directory (tenant_id) SELECT id FROM tenant`);
    await q(`INSERT INTO tenant_settings (tenant_id, settings, updated_at) SELECT id, jsonb_build_object('schemaVersion', 1, 'evaluation', '{}'::jsonb), now() FROM tenant`);
    await q(`INSERT INTO tenant_authz_state (tenant_id) SELECT id FROM tenant`);
    await q(`INSERT INTO tenant_branding (tenant_id, app_name, primary_color, secondary_color) SELECT id, name, '#1d4ed8', '#0f766e' FROM tenant`);
    await q(`INSERT INTO tenant_feature (tenant_id, feature_key, enabled) SELECT t.id, f.key, true FROM tenant t CROSS JOIN feature_definition f`);

    // System roles with their permissions.
    await q(`INSERT INTO role (tenant_id, name, system_key)
             SELECT t.id, r.name, r.key FROM tenant t
             CROSS JOIN (VALUES ('TENANT_ADMIN', 'Tenant admin'), ('MANAGER', 'Manager'), ('EMPLOYEE', 'Employee')) r(key, name)`);
    await q(`INSERT INTO role_permission (tenant_id, role_id, permission_key)
             SELECT r.tenant_id, r.id, p.key FROM role r JOIN permission p
               ON r.system_key = 'TENANT_ADMIN'
               OR (r.system_key = 'MANAGER' AND p.key IN ('user:read','org:read','cycle:read','evaluation:self','evaluation:manage','report:read'))
               OR (r.system_key = 'EMPLOYEE' AND p.key IN ('cycle:read','evaluation:self'))`);

    // Users: n = 1 is the admin; n ≡ 2 (mod 10) are managers of the next nine.
    await q(`CREATE TEMP TABLE bench_user AS
             SELECT t.id AS tenant_id, t.slug, g AS n
               FROM tenant t
               CROSS JOIN LATERAL generate_series(1, $1 + CASE WHEN t.slug = 'bench-1' THEN $2::int ELSE 0 END) g`,
      [shape.users, shape.heavyUsers ?? 0]);
    await q(`ALTER TABLE bench_user ADD COLUMN id uuid DEFAULT uuidv7()`);
    await q(`INSERT INTO app_user (id, tenant_id, email, full_name, password_hash, updated_at)
             SELECT id, tenant_id, 'u' || n || '@' || slug || '.test', 'User ' || n, $1, now() FROM bench_user`, [hash]);
    await q(`INSERT INTO user_role (tenant_id, user_id, role_id)
             SELECT u.tenant_id, u.id, r.id FROM bench_user u JOIN role r ON r.tenant_id = u.tenant_id
              AND r.system_key = CASE WHEN u.n = 1 THEN 'TENANT_ADMIN' WHEN u.n % 10 = 2 THEN 'MANAGER' ELSE 'EMPLOYEE' END`);
    await q(`INSERT INTO employee_profile (tenant_id, user_id, manager_id)
             SELECT u.tenant_id, u.id, m.id FROM bench_user u
               JOIN bench_user m ON m.tenant_id = u.tenant_id
                AND m.n = CASE WHEN u.n % 10 = 2 THEN 1 ELSE ((u.n - 2) / 10) * 10 + 2 END
              WHERE u.n > 1 AND u.n <> m.n`);

    // Cycles (oldest closed, latest active), competencies.
    await q(`INSERT INTO evaluation_cycle (tenant_id, name, status, starts_on, ends_on, policy_snapshot)
             SELECT t.id, 'Cycle ' || c, CASE WHEN c = $1 THEN 'ACTIVE' ELSE 'CLOSED' END::"CycleStatus",
                    date '2025-01-01' + (c - 1) * interval '3 months', date '2025-03-31' + (c - 1) * interval '3 months', $2::jsonb
               FROM tenant t CROSS JOIN generate_series(1, $1) c`, [shape.cycles, policy]);
    await q(`INSERT INTO competency (tenant_id, cycle_id, name, weight, position)
             SELECT c.tenant_id, c.id, 'Competency ' || k, 100 / $1::int, k - 1 FROM evaluation_cycle c CROSS JOIN generate_series(1, $1::int) k`,
      [shape.competencies]);

    // Evaluations: published in closed cycles, a realistic mix in the active one.
    await q(`INSERT INTO evaluation (tenant_id, cycle_id, employee_id, manager_id, status, final_score, published_at, updated_at)
             SELECT p.tenant_id, c.id, p.user_id, p.manager_id,
                    CASE WHEN c.status = 'CLOSED' THEN 'PUBLISHED'
                         ELSE (ARRAY['DRAFT','SELF_SUBMITTED','MANAGER_SUBMITTED','PUBLISHED'])[1 + abs(hashtext(p.user_id::text)) % 4] END::"EvaluationStatus",
                    CASE WHEN c.status = 'CLOSED' THEN round((random() * 100)::numeric, 2) END,
                    CASE WHEN c.status = 'CLOSED' THEN now() END, now()
               FROM employee_profile p JOIN evaluation_cycle c ON c.tenant_id = p.tenant_id`);
    await q(`INSERT INTO evaluation_score (tenant_id, evaluation_id, competency_id, evaluator, score)
             SELECT e.tenant_id, e.id, k.id, ev.kind::"EvaluatorKind", 1 + (random() * 4)::int
               FROM evaluation e
               JOIN competency k ON k.tenant_id = e.tenant_id AND k.cycle_id = e.cycle_id
               CROSS JOIN (VALUES ('SELF'), ('MANAGER')) ev(kind)`);

    await q(`INSERT INTO audit_log (tenant_id, category, action, actor_type, actor_id, entity_type, entity_id, metadata)
             SELECT u.tenant_id, CASE WHEN g % 10 = 0 THEN 'SECURITY' ELSE 'CHANGE' END, 'bench.event', 'USER', u.id, 'evaluation', u.id::text, '{}'::jsonb
               FROM bench_user u CROSS JOIN generate_series(1, greatest(1, $1::int / $2::int)) g WHERE u.n <= $2::int`,
      [shape.auditPerTenant ?? 200, Math.min(shape.users, 20)]);

    for (const t of TENANT_TABLES) await db.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`);
    await q('ANALYZE');
    const forced = await q(`SELECT count(*)::int AS n FROM pg_class WHERE relname = ANY($1) AND relforcerowsecurity`, [TENANT_TABLES]);
    if (forced.rows[0].n !== TENANT_TABLES.length) throw new Error('FORCE ROW LEVEL SECURITY was not restored');

    const rows: Record<string, number> = {};
    for (const t of ['tenant', 'app_user', 'evaluation', 'evaluation_score', 'audit_log']) {
      rows[t] = Number((await q(`SELECT reltuples::bigint AS n FROM pg_class WHERE relname = $1`, [t])).rows[0].n);
    }
    return { seconds: Math.round((performance.now() - started) / 100) / 10, rows };
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  const arg = (name: string, def: number) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def);
  generate({ tenants: arg('tenants', 10), users: arg('users', 50), cycles: arg('cycles', 4), competencies: arg('competencies', 20), heavyUsers: arg('heavy', 0) })
    .then((r) => console.log(r))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
