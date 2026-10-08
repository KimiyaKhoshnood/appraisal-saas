import { existsSync } from 'node:fs';

/**
 * Test environment: same variables as development, pointed at the dedicated test database.
 * CI provides the variables directly; locally they come from .env.
 */
if (existsSync('.env')) process.loadEnvFile('.env');

const testDb = process.env.TEST_DATABASE_NAME ?? 'appraisal_test';
function withDb(url: string | undefined): string | undefined {
  if (!url) return url;
  const u = new URL(url);
  u.pathname = `/${testDb}`;
  return u.toString();
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = withDb(process.env.DATABASE_URL);
process.env.MIGRATOR_DATABASE_URL = withDb(process.env.MIGRATOR_DATABASE_URL);
process.env.LOG_LEVEL = 'silent';
process.env.COOKIE_SECURE = 'false';
process.env.BASE_DOMAIN = 'localhost';
process.env.TENANT_JWT_SECRET ??= 'test-tenant-secret-0123456789abcdefghij';
process.env.PLATFORM_JWT_SECRET ??= 'test-platform-secret-0123456789abcdefgh';
// Generous unless a suite (E4, throttling) lowers it explicitly.
process.env.RATE_LIMIT_PER_TENANT_PER_MINUTE ??= '100000';
process.env.TENANCY_APP_FILTER ??= 'on';
// Reuse detection is tested strictly; the benign-race grace window has its own test.
process.env.REFRESH_REUSE_GRACE_MS ??= '0';
