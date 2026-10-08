/**
 * One-command demo reset (demo insurance, R5): drop the schema, re-apply every migration,
 * sync the catalogs and load the seed. Refuses to run in production or against a database
 * whose name does not look like this project's.
 *
 *   pnpm db:reset                 → main database + seed
 *   pnpm db:reset -- --test       → test database, no seed
 *   pnpm db:reset -- --no-seed    → main database, empty
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Client } from 'pg';
import { syncCatalog } from '../prisma/sync-catalog';

export async function resetDatabase(options: { test?: boolean; database?: string; seed?: boolean; quiet?: boolean } = {}): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database');
  const base = process.env.MIGRATOR_DATABASE_URL;
  if (!base) throw new Error('MIGRATOR_DATABASE_URL is not set');
  const url = new URL(base);
  if (options.test) url.pathname = `/${process.env.TEST_DATABASE_NAME ?? 'appraisal_test'}`;
  if (options.database) url.pathname = `/${options.database}`;
  const dbName = url.pathname.slice(1);
  if (!/^appraisal(_[a-z0-9]+)?$/.test(dbName)) {
    throw new Error(`Refusing to reset "${dbName}": not an appraisal database`);
  }
  const log = options.quiet ? () => {} : console.log;

  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  } finally {
    await client.end();
  }
  log(`schema dropped: ${dbName}`);

  const env = { ...process.env, MIGRATOR_DATABASE_URL: url.toString() };
  const stdio = options.quiet ? 'pipe' : 'inherit';
  execFileSync(process.execPath, [createRequire(join(process.cwd(), 'package.json')).resolve('prisma/build/index.js'), 'migrate', 'deploy'], { stdio, env });
  log(await syncCatalog(url.toString()));
  if (options.seed) {
    execFileSync(process.execPath, ['-r', '@swc-node/register', 'prisma/seed.ts'], { stdio, env });
  }
}

// Entry point when run directly (tsx, CommonJS); inert when imported by the test setup.
if (typeof require !== 'undefined' && require.main === module) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const args = new Set(process.argv.slice(2));
  const test = args.has('--test');
  resetDatabase({ test, seed: !test && !args.has('--no-seed') }).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
