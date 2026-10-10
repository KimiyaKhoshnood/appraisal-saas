import type { AppKind } from './host';

/**
 * Accounts created by `apps/api/prisma/seed.ts`, shown on the login page in development only
 * (`import.meta.env.DEV` is false in a production build, so the list is dropped from the bundle).
 * Each host lists only its own accounts: a tenant user cannot sign in on another tenant's
 * sub-domain or on the operator console, by design (ADR-003, ADR-005).
 */
export const DEMO_PASSWORD = 'Demo-pass-2026';

export interface DemoAccount {
  email: string;
  role: string;
}

const accounts: Record<string, DemoAccount[]> = {
  acme: [
    { email: 'ada@acme.test', role: 'admin' },
    { email: 'max@acme.test', role: 'manager' },
    { email: 'eve@acme.test', role: 'employee' },
    { email: 'hana@acme.test', role: 'HR reviewer' },
  ],
  globex: [
    { email: 'gita@globex.test', role: 'admin' },
    { email: 'kian@globex.test', role: 'manager' },
    { email: 'sara@globex.test', role: 'employee' },
  ],
  platform: [{ email: 'platform@appraisal.test', role: 'operator' }],
};

export function demoAccountsFor(app: AppKind): DemoAccount[] {
  if (!import.meta.env.DEV) return [];
  if (app.kind === 'platform') return accounts.platform!;
  if (app.kind === 'tenant') return accounts[app.slug] ?? [];
  return [];
}
