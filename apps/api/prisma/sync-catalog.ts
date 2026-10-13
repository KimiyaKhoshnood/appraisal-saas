/**
 * Synchronises the read-only catalogs (permissions, features, plans) from @appraisal/contracts
 * into the database. Runs as the migrator because the runtime role may only read these tables.
 * Idempotent: safe to run after every deploy.
 */
import { existsSync } from 'node:fs';
import { Client } from 'pg';
import { FEATURES, PERMISSIONS, PLANS, SYSTEM_ROLE_TEMPLATES } from '@appraisal/contracts';

export async function syncCatalog(connectionString: string): Promise<string> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const [key, description] of Object.entries(PERMISSIONS)) {
      await client.query(
        `INSERT INTO permission (key, description) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description`,
        [key, description],
      );
    }
    for (const [key, description] of Object.entries(FEATURES)) {
      await client.query(
        `INSERT INTO feature_definition (key, description) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description`,
        [key, description],
      );
    }
    for (const [code, plan] of Object.entries(PLANS)) {
      await client.query(
        `INSERT INTO plan (code, name) VALUES ($1, $2)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
        [code, plan.name],
      );
      await client.query('DELETE FROM plan_feature WHERE plan_code = $1', [code]);
      for (const feature of plan.features) {
        await client.query('INSERT INTO plan_feature (plan_code, feature_key) VALUES ($1, $2)', [code, feature]);
      }
    }
    const upgraded = await upgradeSystemRoles(client);
    await client.query('COMMIT');
    return `catalog synced: ${Object.keys(PERMISSIONS).length} permissions, ${Object.keys(FEATURES).length} features, ${Object.keys(PLANS).length} plans; ${upgraded} system-role grants added`;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

/**
 * A permission added to a system role template must reach the tenants that already exist
 * (additive only: a permission an admin removed from a *custom* role is never touched, and
 * system roles only ever gain). The migrator is subject to FORCE RLS like everyone else, so it
 * visits one tenant at a time with the transaction-local tenant setting, exactly as the API does,
 * and bumps the tenant's authorisation version so cached permission sets are refreshed.
 */
async function upgradeSystemRoles(client: Client): Promise<number> {
  const { rows: tenants } = await client.query<{ id: string }>('SELECT id FROM tenant ORDER BY id');
  let added = 0;
  for (const { id } of tenants) {
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [id]);
    let tenantAdded = 0;
    for (const [systemKey, template] of Object.entries(SYSTEM_ROLE_TEMPLATES)) {
      const res = await client.query(
        `INSERT INTO role_permission (tenant_id, role_id, permission_key)
         SELECT r.tenant_id, r.id, p.key FROM role r CROSS JOIN unnest($2::text[]) AS p(key)
         WHERE r.system_key = $1
         ON CONFLICT DO NOTHING`,
        [systemKey, template.permissions],
      );
      tenantAdded += res.rowCount ?? 0;
    }
    if (tenantAdded > 0) await client.query('UPDATE tenant_authz_state SET version = version + 1');
    added += tenantAdded;
  }
  await client.query(`SELECT set_config('app.tenant_id', '', true)`);
  return added;
}

if (typeof require !== 'undefined' && require.main === module) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  syncCatalog(process.env.MIGRATOR_DATABASE_URL!)
    .then((msg) => console.log(msg))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
