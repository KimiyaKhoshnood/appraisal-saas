/**
 * Synchronises the read-only catalogs (permissions, features, plans) from @appraisal/contracts
 * into the database. Runs as the migrator because the runtime role may only read these tables.
 * Idempotent: safe to run after every deploy.
 */
import { existsSync } from 'node:fs';
import { Client } from 'pg';
import { FEATURES, PERMISSIONS, PLANS } from '@appraisal/contracts';

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
    await client.query('COMMIT');
    return `catalog synced: ${Object.keys(PERMISSIONS).length} permissions, ${Object.keys(FEATURES).length} features, ${Object.keys(PLANS).length} plans`;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
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
