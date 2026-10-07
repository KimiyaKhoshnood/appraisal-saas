/**
 * Demo seed. Everything except the platform admin is created through the application's own
 * services, under the runtime role and RLS: the seed is itself a proof that onboarding a tenant
 * is "adding data" (NF-11) and that nothing needs to bypass RLS (ADR-012).
 *
 * All names are fictional. Every demo account uses the password in SEED_PASSWORD.
 */
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import type { EvaluationPolicyOverride, Branding } from '@appraisal/contracts';
import { AppModule } from '../src/app/app.module';
import { ACCESS_CONTEXT_LOADER, TenantContext, hashPassword, type AccessContextLoader, type TenantRecord } from '../src/core';
import { CyclesService } from '../src/modules/evaluation/cycles.service';
import { EvaluationsService } from '../src/modules/evaluation/evaluations.service';
import { IamProvisioning } from '../src/modules/iam';
import { RolesService } from '../src/modules/iam/roles.service';
import { OrganizationService } from '../src/modules/organization/organization.service';
import { TenantDirectoryService, TenantsService } from '../src/modules/platform';

if (existsSync('.env')) process.loadEnvFile('.env');
export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'Demo-pass-2026';
const PLATFORM_ADMIN = { email: 'platform@appraisal.test', fullName: 'Pat Platform' };

interface PersonSpec {
  key: string;
  email: string;
  fullName: string;
  roles: ('TENANT_ADMIN' | 'MANAGER' | 'EMPLOYEE' | 'HR')[];
  manager?: string;
  department?: string;
  jobTitle?: string;
}

interface TenantSpec {
  name: string;
  slug: string;
  plan: 'STARTER' | 'BUSINESS' | 'ENTERPRISE';
  branding: Branding;
  features: string[];
  policy: EvaluationPolicyOverride;
  departments: string[];
  people: PersonSpec[];
  cycles: { past: string; current: string };
  /** Employee whose evaluation is moved one step ahead in the current cycle. */
  showcase: string;
}

const ACME: TenantSpec = {
  name: 'Acme Robotics',
  slug: 'acme',
  plan: 'ENTERPRISE',
  branding: { appName: 'Acme Review', logoUrl: null, primaryColor: '#1d4ed8', secondaryColor: '#0f766e', locale: 'en' },
  features: ['reports', 'analytics', 'csvExport', 'customRoles'],
  // Acme: self-assessment AND a single approval before publishing.
  policy: { cycle: 'QUARTERLY', scale: { min: 1, max: 5 }, selfAssessmentRequired: true, approvalRequired: true, approvalStrategy: 'SINGLE', resultVisibility: 'AFTER_PUBLISH' },
  departments: ['Engineering', 'Sales', 'People'],
  cycles: { past: '2026 Q2', current: '2026 Q3' },
  showcase: 'eve',
  people: [
    { key: 'ada', email: 'ada@acme.test', fullName: 'Ada Admin', roles: ['TENANT_ADMIN'], department: 'People', jobTitle: 'Head of People' },
    { key: 'hana', email: 'hana@acme.test', fullName: 'Hana Reviewer', roles: ['EMPLOYEE', 'HR'], manager: 'ada', department: 'People', jobTitle: 'HR Partner' },
    { key: 'max', email: 'max@acme.test', fullName: 'Max Manager', roles: ['MANAGER'], manager: 'ada', department: 'Engineering', jobTitle: 'Engineering Manager' },
    { key: 'mona', email: 'mona@acme.test', fullName: 'Mona Lead', roles: ['MANAGER'], manager: 'ada', department: 'Sales', jobTitle: 'Sales Lead' },
    { key: 'eve', email: 'eve@acme.test', fullName: 'Eve Engineer', roles: ['EMPLOYEE'], manager: 'max', department: 'Engineering', jobTitle: 'Software Engineer' },
    { key: 'evan', email: 'evan@acme.test', fullName: 'Evan Engineer', roles: ['EMPLOYEE'], manager: 'max', department: 'Engineering', jobTitle: 'Software Engineer' },
    { key: 'erin', email: 'erin@acme.test', fullName: 'Erin Engineer', roles: ['EMPLOYEE'], manager: 'max', department: 'Engineering', jobTitle: 'QA Engineer' },
    { key: 'sam', email: 'sam@acme.test', fullName: 'Sam Seller', roles: ['EMPLOYEE'], manager: 'mona', department: 'Sales', jobTitle: 'Account Executive' },
    { key: 'sia', email: 'sia@acme.test', fullName: 'Sia Seller', roles: ['EMPLOYEE'], manager: 'mona', department: 'Sales', jobTitle: 'Account Executive' },
  ],
};

const GLOBEX: TenantSpec = {
  name: 'Globex Logistics',
  slug: 'globex',
  plan: 'BUSINESS',
  branding: { appName: 'ارزیابی گلوبکس', logoUrl: null, primaryColor: '#b45309', secondaryColor: '#7c3aed', locale: 'fa' },
  features: ['reports'],
  // Globex: no self-assessment, no approval; 1–10 scale; employees never see manager results.
  policy: { cycle: 'MONTHLY', scale: { min: 1, max: 10 }, selfAssessmentRequired: false, approvalRequired: false, approvalStrategy: 'SINGLE', resultVisibility: 'MANAGERS_ONLY' },
  departments: ['Operations', 'Fleet'],
  cycles: { past: 'Tir 1405', current: 'Mehr 1405' },
  showcase: 'sara',
  people: [
    { key: 'gita', email: 'gita@globex.test', fullName: 'گیتا مدیرسیستم', roles: ['TENANT_ADMIN'], department: 'Operations', jobTitle: 'Operations Director' },
    { key: 'kian', email: 'kian@globex.test', fullName: 'کیان مدیر', roles: ['MANAGER'], manager: 'gita', department: 'Fleet', jobTitle: 'Fleet Manager' },
    { key: 'sara', email: 'sara@globex.test', fullName: 'سارا رانندگان', roles: ['EMPLOYEE'], manager: 'kian', department: 'Fleet', jobTitle: 'Dispatcher' },
    { key: 'reza', email: 'reza@globex.test', fullName: 'رضا لجستیک', roles: ['EMPLOYEE'], manager: 'kian', department: 'Fleet', jobTitle: 'Driver' },
    { key: 'nika', email: 'nika@globex.test', fullName: 'نیکا برنامه‌ریز', roles: ['EMPLOYEE'], manager: 'gita', department: 'Operations', jobTitle: 'Planner' },
  ],
};

async function createPlatformAdmin(passwordHash: string): Promise<string> {
  const client = new Client({ connectionString: process.env.MIGRATOR_DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query<{ id: string }>(
      `INSERT INTO platform_admin (email, full_name, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [PLATFORM_ADMIN.email, PLATFORM_ADMIN.fullName, passwordHash],
    );
    return res.rows[0]!.id;
  } finally {
    await client.end();
  }
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const tenants = app.get(TenantsService);
  const directory = app.get(TenantDirectoryService);
  const iam = app.get(IamProvisioning);
  const roles = app.get(RolesService, { strict: false });
  const org = app.get(OrganizationService, { strict: false });
  const cycles = app.get(CyclesService, { strict: false });
  const evaluations = app.get(EvaluationsService, { strict: false });
  const loader = app.get<AccessContextLoader>(ACCESS_CONTEXT_LOADER);

  const passwordHash = await hashPassword(SEED_PASSWORD);
  const platformAdminId = await createPlatformAdmin(passwordHash);
  const platformActor = { type: 'PLATFORM_ADMIN' as const, id: platformAdminId, name: PLATFORM_ADMIN.fullName };

  /** Runs `fn` as a given user of a tenant, with the same AccessContext the HTTP guard builds. */
  const asUser = async <T>(tenant: TenantRecord, userId: string, fn: () => Promise<T>): Promise<T> =>
    TenantContext.runAs(tenant.id, { type: 'USER', id: userId, name: null }, async () => {
      const access = await loader.load(tenant, userId);
      if (!access) throw new Error(`seed: no access for ${userId}`);
      const store = TenantContext.current()!;
      store.access = access;
      store.actor = { type: 'USER', id: userId, name: access.user.fullName };
      return fn();
    });

  const summary: string[] = [];

  for (const spec of [ACME, GLOBEX]) {
    const admin = spec.people[0]!;
    // Platform scope: the onboarding service enters the new tenant's context by itself.
    const created = await TenantContext.runPlatform(platformActor, () =>
      tenants.create({
        name: spec.name,
        slug: spec.slug,
        plan: spec.plan,
        admin: { email: admin.email, fullName: admin.fullName, password: SEED_PASSWORD },
        branding: spec.branding,
        features: spec.features,
        evaluationPolicy: spec.policy,
      }),
    );
    const tenant = (await directory.byId(created.tenant.id))!;
    const ids = new Map<string, string>([[admin.key, created.adminUserId]]);

    await asUser(tenant, created.adminUserId, async () => {
      const roleList = await roles.list();
      const roleId = (key: string) => roleList.find((r) => r.systemKey === key)?.id;
      let hrRoleId: string | undefined;
      if (spec.features.includes('customRoles')) {
        hrRoleId = (await roles.create({ name: 'HR reviewer', permissions: ['evaluation:approve', 'evaluation:self', 'cycle:read', 'user:read', 'org:read'] })).id;
      }
      for (const p of spec.people.slice(1)) {
        const r = p.roles.map((k) => (k === 'HR' ? hrRoleId : roleId(k))).filter((x): x is string => Boolean(x));
        ids.set(p.key, await iam.createUser({ email: p.email, fullName: p.fullName, passwordHash, roleIds: r }));
      }
      const depts = new Map<string, string>();
      for (const d of spec.departments) depts.set(d, (await org.createDepartment(d)).id);
      for (const p of spec.people) {
        await org.updateProfile(ids.get(p.key)!, {
          ...(p.department ? { departmentId: depts.get(p.department)! } : {}),
          ...(p.manager ? { managerId: ids.get(p.manager)! } : {}),
          ...(p.jobTitle ? { jobTitle: p.jobTitle } : {}),
        });
      }
    });

    // A closed past cycle with published results (trend/analytics data) and an active one.
    const past = await asUser(tenant, created.adminUserId, () => cycles.create({ name: spec.cycles.past, startsOn: '2026-04-01' }));
    await asUser(tenant, created.adminUserId, () => cycles.activate(past.id));
    const scale = spec.policy.scale!;
    const evals = await asUser(tenant, created.adminUserId, () => evaluations.list({ scope: 'all', cycleId: past.id, limit: 100 }));
    let n = 0;
    for (const e of evals.items) {
      const detail = await asUser(tenant, e.employee.id, () => evaluations.get(e.id));
      const scoreFor = (offset: number) =>
        detail.competencies.map((c, i) => ({ competencyId: c.id, score: Math.min(scale.max, scale.min + ((n + i + offset) % (scale.max - scale.min + 1))) }));
      if (spec.policy.selfAssessmentRequired) await asUser(tenant, e.employee.id, () => evaluations.submit(e.id, 'SELF', { scores: scoreFor(1) }));
      await asUser(tenant, e.manager!.id, () => evaluations.submit(e.id, 'MANAGER', { scores: scoreFor(2) }));
      if (spec.policy.approvalRequired) {
        // Separation of duties: neither the employee nor their manager may approve.
        const approver = [created.adminUserId, ids.get('hana')].find((id) => id && id !== e.manager!.id && id !== e.employee.id);
        if (approver) await asUser(tenant, approver, () => evaluations.approve(e.id, 'Calibrated in review meeting'));
      }
      n++;
    }
    await asUser(tenant, created.adminUserId, () => cycles.close(past.id));

    const current = await asUser(tenant, created.adminUserId, () => cycles.create({ name: spec.cycles.current, startsOn: '2026-07-01' }));
    await asUser(tenant, created.adminUserId, () => cycles.activate(current.id));
    // Leave the current cycle mid-flight: one evaluation one step ahead, the rest in draft.
    const open = await asUser(tenant, created.adminUserId, () => evaluations.list({ scope: 'all', cycleId: current.id, limit: 100 }));
    const first = open.items.find((e) => e.employee.id === ids.get(spec.showcase));
    if (first) {
      const detail = await asUser(tenant, first.employee.id, () => evaluations.get(first.id));
      const scores = detail.competencies.map((c) => ({ competencyId: c.id, score: scale.max - 1 }));
      if (spec.policy.selfAssessmentRequired) await asUser(tenant, first.employee.id, () => evaluations.submit(first.id, 'SELF', { scores }));
      else await asUser(tenant, first.manager!.id, () => evaluations.submit(first.id, 'MANAGER', { scores }));
    }

    summary.push(
      `  ${spec.name.padEnd(18)} http://${spec.slug}.localhost:5173   ${spec.people.map((p) => p.email).join(', ')}`,
    );
  }

  await app.close();
  console.log('\nSeed complete. Password for every account:', SEED_PASSWORD);
  console.log(`  Platform console   http://admin.localhost:5173   ${PLATFORM_ADMIN.email}`);
  console.log(summary.join('\n'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
