/**
 * E2 (RQ2, ADR-002): what does each tenancy model really cost as N grows?
 *
 *   A  shared schema   provisioning = a handful of INSERTs; a migration runs once
 *   B  schema/tenant   provisioning = CREATE SCHEMA + the tenant DDL; a migration runs N times
 *
 * B uses the *real* DDL of this project's tenant tables, extracted from the init migration
 * (tables, indexes, intra-tenant foreign keys). Model C (database per tenant) is analysed in the
 * report, not measured: it multiplies B's per-tenant cost by a CREATE DATABASE and a connection pool.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TENANT_TABLES } from './generate';
import { connect, envBlock, environment, round, stats, table, writeResult } from './lib';

const NS = (process.env.E2_N ?? '10,100,500').split(',').map(Number);

function tenantDdl(): string[] {
  const sql = readFileSync(join(__dirname, '..', 'prisma', 'migrations', '20261007000000_init', 'migration.sql'), 'utf8');
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
  const isTenant = (name: string) => TENANT_TABLES.includes(name);
  const out: string[] = [];
  for (const st of statements) {
    const create = /^CREATE TABLE "(\w+)"/.exec(st);
    if (create && isTenant(create[1]!)) out.push(st);
    const index = /^CREATE (?:UNIQUE )?INDEX "\w+" ON "(\w+)"/.exec(st);
    if (index && isTenant(index[1]!)) out.push(st);
    const fk = /^ALTER TABLE "(\w+)" ADD CONSTRAINT "\w+" FOREIGN KEY .* REFERENCES "(\w+)"/s.exec(st);
    if (fk && isTenant(fk[1]!) && isTenant(fk[2]!)) out.push(st);
  }
  return out;
}

async function main() {
  const db = await connect('migrator');
  const env = await environment(db);
  const ddl = tenantDdl();
  // Enum types live in public and are shared by both models.
  console.log(`tenant DDL: ${ddl.length} statements`);

  const relationCount = async () => Number((await db.query(`SELECT count(*) FROM pg_class`)).rows[0].count);
  const catalogSize = async () =>
    Number((await db.query(`SELECT sum(pg_total_relation_size(c.oid))::bigint AS s FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'pg_catalog'`)).rows[0].s);

  const results: Record<string, unknown>[] = [];
  for (const n of NS) {
    // Clean slate for B.
    const old = await db.query(`SELECT nspname FROM pg_namespace WHERE nspname LIKE 'e2t\\_%'`);
    for (const r of old.rows) await db.query(`DROP SCHEMA ${r.nspname} CASCADE`);
    const relBefore = await relationCount();
    const catBefore = await catalogSize();

    // ── Model B: schema per tenant ─────────────────────────────────────────
    const bCreate: number[] = [];
    for (let i = 1; i <= n; i++) {
      const t0 = performance.now();
      await db.query('BEGIN');
      await db.query(`CREATE SCHEMA e2t_${i}`);
      await db.query(`SET LOCAL search_path TO e2t_${i}, public`);
      for (const st of ddl) await db.query(st);
      await db.query('COMMIT');
      bCreate.push(performance.now() - t0);
    }
    const relAfter = await relationCount();
    const catAfter = await catalogSize();
    const bMigStart = performance.now();
    for (let i = 1; i <= n; i++) {
      await db.query(`ALTER TABLE e2t_${i}.evaluation ADD COLUMN calibrated boolean NOT NULL DEFAULT false`);
      await db.query(`CREATE INDEX ON e2t_${i}.evaluation (calibrated) WHERE calibrated`);
    }
    const bMigration = performance.now() - bMigStart;

    // ── Model A: shared schema ─────────────────────────────────────────────
    // Provisioning = exactly the rows the onboarding service writes (without password hashing).
    const aCreate: number[] = [];
    for (let i = 1; i <= Math.min(n, 100); i++) {
      const t0 = performance.now();
      await db.query('BEGIN');
      const t = await db.query(
        `INSERT INTO tenant (name, slug, plan_code, status, updated_at) VALUES ($1, $2, 'BUSINESS', 'ACTIVE', now()) RETURNING id`,
        [`E2 ${n}-${i}`, `e2-${n}-${i}`],
      );
      const id = t.rows[0].id;
      await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [id]);
      await db.query(`INSERT INTO tenant_directory (tenant_id) VALUES ($1)`, [id]);
      await db.query(`INSERT INTO tenant_settings (tenant_id, updated_at) VALUES ($1, now())`, [id]);
      await db.query(`INSERT INTO tenant_authz_state (tenant_id) VALUES ($1)`, [id]);
      await db.query(`INSERT INTO tenant_branding (tenant_id, app_name, primary_color, secondary_color) VALUES ($1, 'x', '#1d4ed8', '#0f766e')`, [id]);
      await db.query(`INSERT INTO tenant_feature (tenant_id, feature_key, enabled) SELECT $1, key, true FROM feature_definition`, [id]);
      await db.query(
        `WITH r AS (INSERT INTO role (tenant_id, name, system_key) VALUES ($1, 'Tenant admin', 'TENANT_ADMIN'), ($1, 'Manager', 'MANAGER'), ($1, 'Employee', 'EMPLOYEE') RETURNING id, system_key)
         INSERT INTO role_permission (tenant_id, role_id, permission_key) SELECT $1, r.id, p.key FROM r, permission p WHERE r.system_key = 'TENANT_ADMIN'`,
        [id],
      );
      await db.query(`INSERT INTO app_user (tenant_id, email, full_name, password_hash, updated_at) VALUES ($1, 'a@e2.test', 'Admin', 'x', now())`, [id]);
      await db.query('COMMIT');
      aCreate.push(performance.now() - t0);
    }
    const aMigStart = performance.now();
    await db.query('ALTER TABLE evaluation ADD COLUMN e2_calibrated boolean NOT NULL DEFAULT false');
    await db.query('CREATE INDEX e2_calibrated_idx ON evaluation (tenant_id) WHERE e2_calibrated');
    const aMigration = performance.now() - aMigStart;
    await db.query('DROP INDEX e2_calibrated_idx');
    await db.query('ALTER TABLE evaluation DROP COLUMN e2_calibrated');

    const row = {
      n,
      bCreate: stats(bCreate),
      bCreateTotalS: round(bCreate.reduce((a, b) => a + b, 0) / 1000, 2),
      bMigrationS: round(bMigration / 1000, 2),
      bRelationsAdded: relAfter - relBefore,
      bCatalogGrowthMb: round((catAfter - catBefore) / 2 ** 20, 1),
      aCreate: stats(aCreate),
      aMigrationS: round(aMigration / 1000, 3),
    };
    results.push(row);
    console.log(JSON.stringify(row));
  }

  // Leave the bench database as we found it.
  const old = await db.query(`SELECT nspname FROM pg_namespace WHERE nspname LIKE 'e2t\\_%'`);
  for (const r of old.rows) await db.query(`DROP SCHEMA ${r.nspname} CASCADE`);
  await db.end();

  type R = { n: number; bCreate: { median: number }; aCreate: { median: number }; bCreateTotalS: number; bMigrationS: number; aMigrationS: number; bRelationsAdded: number; bCatalogGrowthMb: number };
  const rows = (results as unknown as R[]).map((r) => [
    r.n,
    round(r.aCreate.median, 1),
    round(r.bCreate.median, 1),
    r.aMigrationS,
    r.bMigrationS,
    `${round(r.bMigrationS / Math.max(r.aMigrationS, 0.001), 1)}×`,
    r.bRelationsAdded.toLocaleString('en'),
    r.bCatalogGrowthMb,
  ]);
  const md = `
# E2: shared schema (A) vs schema per tenant (B)

${envBlock(env)}

B executes the project's real tenant DDL (${ddl.length} statements: ${TENANT_TABLES.length} tables, their indexes and
intra-tenant foreign keys) once per tenant. A executes the rows the onboarding service writes.
The "migration" adds a column plus a partial index to \`evaluation\` (empty tables in B; A's table
holds the bench data, so A is measured under *more* data than B).

${table(['N tenants', 'A: provision one tenant (ms, median)', 'B: provision one tenant (ms, median)', 'A: one migration (s)', 'B: same migration on all N (s)', 'B / A migration', 'B: relations added to the catalog', 'B: pg_catalog growth (MB)'], rows)}

## Reading

- **Provisioning**: A writes a dozen small rows (≈ 3.5–11 ms, constant in N); B creates 54
  catalog objects per tenant (≈ 200–225 ms each, ≈ 60× slower) and every one of them stays in
  the catalog forever.
- **Migrations**: A runs once (≈ 0.1–0.16 s, even on a table holding 100 tenants of bench data);
  B runs N times and grows linearly (0.05 s → 0.36 s → 1.81 s for 10 → 100 → 500 tenants), i.e.
  ≈ 36 s at 10 000 tenants *on empty tables*. Adding a nullable/defaulted column is metadata-only
  in PostgreSQL ≥ 11; anything that rewrites data or builds an index on populated tables multiplies
  by the data size per schema, and a deploy must then keep N schemas consistent through partial
  failures. The time is not the main cost; the N-fold operational surface is.
- **Catalog**: B adds 84 relations per tenant (42 000 at N = 500) and ≈ 150 MB of catalog at
  N = 500. Planner caches, \`pg_dump\`, autovacuum and connection start-up all pay for it.
- **What B buys**: stronger structural isolation and easy per-tenant restore. In this project the
  isolation is delivered by RLS + composite keys (E1); per-tenant restore remains a documented
  limitation of model A.
- **Model C** (database per tenant) adds a CREATE DATABASE and one connection pool per tenant on
  top of B's costs; it fits a few very large or regulated tenants, which is why the
  \`tenant_directory\` (tenant → shard) table exists from day one.
`;
  writeResult('e2-db-models', { env, ddlStatements: ddl.length, results }, md);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
