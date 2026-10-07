import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { CreateTenantInput } from '@appraisal/contracts';
import { AppModule } from '../../src/app/app.module';
import { configureApp } from '../../src/app/configure-app';
import { hashPassword } from '../../src/core';

export const PASSWORD = 'Test-pass-2026';
export const PLATFORM_HOST = 'admin.localhost';
export const hostOf = (slug: string) => `${slug}.localhost`;
export const uniqueSlug = (prefix = 't') => `${prefix}-${randomBytes(4).toString('hex')}`;

let cachedAdmin: { email: string } | null = null;

/** Platform admins are created by an operator (migrator connection), exactly as in production. */
export async function ensurePlatformAdmin(): Promise<{ email: string; password: string }> {
  if (!cachedAdmin) {
    const client = new Client({ connectionString: process.env.MIGRATOR_DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO platform_admin (email, full_name, password_hash) VALUES ($1, 'Test Platform', $2)
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`,
        ['platform@test.test', await hashPassword(PASSWORD)],
      );
    } finally {
      await client.end();
    }
    cachedAdmin = { email: 'platform@test.test' };
  }
  return { ...cachedAdmin, password: PASSWORD };
}

export interface TenantHandle {
  id: string;
  slug: string;
  host: string;
  adminId: string;
  adminToken: string;
  adminEmail: string;
}

export interface Session {
  token: string;
  cookie: string;
}

export class Harness {
  platformToken = '';

  private constructor(readonly app: INestApplication) {}

  static async start(env: Record<string, string> = {}): Promise<Harness> {
    Object.assign(process.env, env);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
    configureApp(app, { logger: false });
    await app.init();
    const h = new Harness(app);
    const admin = await ensurePlatformAdmin();
    const res = await h.http().post('/api/platform/auth/login').set('Host', PLATFORM_HOST).send(admin).expect(200);
    h.platformToken = res.body.accessToken;
    return h;
  }

  http() {
    return request(this.app.getHttpServer() as App);
  }

  /** Request builder bound to a host (sub-domain) and optional bearer token. */
  as(host: string, token?: string) {
    const http = this.http();
    const wrap = (t: request.Test) => {
      t.set('Host', host);
      if (token) t.set('Authorization', `Bearer ${token}`);
      return t;
    };
    return {
      get: (url: string) => wrap(http.get(url)),
      post: (url: string) => wrap(http.post(url)),
      put: (url: string) => wrap(http.put(url)),
      patch: (url: string) => wrap(http.patch(url)),
      delete: (url: string) => wrap(http.delete(url)),
      method: (m: string, url: string) => wrap((http as unknown as Record<string, (u: string) => request.Test>)[m.toLowerCase()]!(url)),
    };
  }

  platform() {
    return this.as(PLATFORM_HOST, this.platformToken);
  }

  async createTenant(overrides: Partial<CreateTenantInput> = {}): Promise<TenantHandle> {
    const slug = overrides.slug ?? uniqueSlug();
    const adminEmail = `admin@${slug}.test`;
    const body: CreateTenantInput = {
      name: `Tenant ${slug}`,
      slug,
      plan: 'ENTERPRISE',
      admin: { email: adminEmail, fullName: 'Tenant Admin', password: PASSWORD },
      ...overrides,
    };
    const res = await this.platform().post('/api/platform/tenants').send(body);
    if (res.status !== 201) throw new Error(`createTenant failed: ${res.status} ${JSON.stringify(res.body)}`);
    const session = await this.login(slug, adminEmail);
    return { id: res.body.tenant.id, slug, host: hostOf(slug), adminId: res.body.adminUserId, adminToken: session.token, adminEmail };
  }

  async login(slug: string, email: string, password = PASSWORD): Promise<Session> {
    const res = await this.as(hostOf(slug)).post('/api/auth/login').send({ email, password });
    if (res.status !== 200) throw new Error(`login ${email}@${slug} failed: ${res.status} ${JSON.stringify(res.body)}`);
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('rt='));
    return { token: res.body.accessToken, cookie: cookie?.split(';')[0] ?? '' };
  }

  /** Creates a user through the API with the named system roles and returns a session. */
  async addUser(t: TenantHandle, key: string, systemRoles: string[], managerId?: string) {
    const roles = (await this.as(t.host, t.adminToken).get('/api/roles').expect(200)).body as { id: string; systemKey: string | null }[];
    const roleIds = systemRoles.map((k) => roles.find((r) => r.systemKey === k)!.id);
    const email = `${key}@${t.slug}.test`;
    const res = await this.as(t.host, t.adminToken)
      .post('/api/users')
      .send({ email, fullName: `${key[0]!.toUpperCase()}${key.slice(1)} Person`, password: PASSWORD, roleIds });
    if (res.status !== 201) throw new Error(`addUser failed: ${res.status} ${JSON.stringify(res.body)}`);
    const id = res.body.id as string;
    if (managerId) await this.as(t.host, t.adminToken).put(`/api/org/employees/${id}`).send({ managerId }).expect(200);
    const session = await this.login(t.slug, email);
    return { id, email, token: session.token };
  }

  async close() {
    await this.app.close();
  }
}

/** A small organisation: admin → manager → two employees, plus an active cycle. */
export async function buildOrg(h: Harness, t: TenantHandle) {
  const manager = await h.addUser(t, 'manager', ['MANAGER'], t.adminId);
  const emp1 = await h.addUser(t, 'emp1', ['EMPLOYEE'], manager.id);
  const emp2 = await h.addUser(t, 'emp2', ['EMPLOYEE'], manager.id);
  const admin = h.as(t.host, t.adminToken);
  const cycle = (await admin.post('/api/cycles').send({ name: 'Cycle 1', startsOn: '2026-07-01' }).expect(201)).body;
  await admin.post(`/api/cycles/${cycle.id}/activate`).expect(200);
  const evals = (await admin.get(`/api/evaluations?scope=all&cycleId=${cycle.id}`).expect(200)).body.items as {
    id: string;
    employee: { id: string };
  }[];
  const evalOf = (userId: string) => evals.find((e) => e.employee.id === userId)!.id;
  return { manager, emp1, emp2, cycle, evalOf, competencies: cycle.competencies as { id: string; weight: number }[] };
}

export const scoresFor = (competencies: { id: string }[], score: number) => ({
  scores: competencies.map((c) => ({ competencyId: c.id, score })),
});
