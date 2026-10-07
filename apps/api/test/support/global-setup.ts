import { existsSync } from 'node:fs';
import { resetDatabase } from '../../scripts/reset-db';

/** Rebuilds the test database once per run: drop schema → migrations → catalog sync. */
export default async function setup() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  await resetDatabase({ test: true, quiet: true });
}
