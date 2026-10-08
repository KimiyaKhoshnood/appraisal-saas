/**
 * E4 (RQ4, RQ5, NF-09, T9): how much does one heavy tenant slow the others down, and what do
 * the per-tenant controls buy?
 *
 * The real API runs in-process against the bench database. A light tenant measures its own
 * latency on everyday endpoints while a heavy tenant (100× the employees) hammers an expensive
 * report with many concurrent clients. Four scenarios, each a fresh application instance:
 *   S0  light tenant alone                             (reference)
 *   S1  heavy load, no controls                        (rate limit off, no statement timeout)
 *   S2  heavy load, per-tenant rate limit
 *   S3  heavy load, rate limit + statement_timeout
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { BENCH_PASSWORD, generate } from './generate';
import { benchUrl, connect, envBlock, environment, round, stats, table, writeResult } from './lib';

const DURATION_MS = Number(process.env.E4_DURATION ?? 20_000);
const HEAVY_CLIENTS = Number(process.env.E4_HEAVY_CLIENTS ?? 24);
const SHAPE = { tenants: 10, users: 20, cycles: 4, competencies: 20, heavyUsers: 1980 };

const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });

function request(port: number, host: string, path: string, opts: { method?: string; token?: string; body?: unknown } = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: opts.method ?? 'GET',
        agent,
        headers: {
          host,
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
          ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function startApp(env: Record<string, string>): Promise<{ app: INestApplication; port: number }> {
  Object.assign(process.env, env);
  // Imported lazily so the environment above is what the app validates at boot.
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../src/app/app.module');
  const { configureApp } = await import('../src/app/configure-app');
  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
  configureApp(app, { logger: false });
  await app.listen(0, '127.0.0.1');
  return { app, port: (app.getHttpServer().address() as AddressInfo).port };
}

async function login(port: number, slug: string): Promise<string> {
  const res = await request(port, `${slug}.localhost`, '/api/auth/login', { method: 'POST', body: { email: `u1@${slug}.test`, password: BENCH_PASSWORD } });
  if (res.status !== 200) throw new Error(`login ${slug}: ${res.status} ${res.body}`);
  return JSON.parse(res.body).accessToken;
}

interface Scenario {
  id: string;
  label: string;
  heavy: boolean;
  env: Record<string, string>;
}

const BASE_ENV = {
  DATABASE_URL: benchUrl('runtime'),
  LOG_LEVEL: 'silent',
  NODE_ENV: 'test',
  COOKIE_SECURE: 'false',
  BASE_DOMAIN: 'localhost',
  DB_POOL_MAX: '10',
};

const SCENARIOS: Scenario[] = [
  { id: 'S0', label: 'light tenant alone', heavy: false, env: { RATE_LIMIT_PER_TENANT_PER_MINUTE: '0', STATEMENT_TIMEOUT_MS: '0' } },
  { id: 'S1', label: 'heavy load, no controls', heavy: true, env: { RATE_LIMIT_PER_TENANT_PER_MINUTE: '0', STATEMENT_TIMEOUT_MS: '0' } },
  { id: 'S2', label: 'heavy load + per-tenant rate limit (600/min)', heavy: true, env: { RATE_LIMIT_PER_TENANT_PER_MINUTE: '600', STATEMENT_TIMEOUT_MS: '0' } },
  {
    id: 'S3',
    label: 'heavy load + rate limit + statement_timeout 150 ms',
    heavy: true,
    env: { RATE_LIMIT_PER_TENANT_PER_MINUTE: '600', STATEMENT_TIMEOUT_MS: '150' },
  },
];

async function runScenario(s: Scenario) {
  const { app, port } = await startApp({ ...BASE_ENV, ...s.env });
  try {
    const lightToken = await login(port, 'bench-2');
    const heavyToken = await login(port, 'bench-1');
    const light = 'bench-2.localhost';
    const heavy = 'bench-1.localhost';
    const lightPaths = ['/api/me/context', '/api/evaluations?scope=team&limit=20', '/api/cycles'];
    const heavyPaths = ['/api/reports/summary', '/api/analytics/overview', '/api/evaluations?scope=all&limit=100'];

    // Warm-up.
    for (let i = 0; i < 30; i++) await request(port, light, lightPaths[i % lightPaths.length]!, { token: lightToken });

    const until = Date.now() + DURATION_MS;
    const lightLatencies: number[] = [];
    const lightStatus: Record<number, number> = {};
    const heavyStatus: Record<number, number> = {};
    let heavyOk = 0;

    const heavyLoop = async (k: number) => {
      let i = k;
      while (Date.now() < until) {
        const res = await request(port, heavy, heavyPaths[i++ % heavyPaths.length]!, { token: heavyToken });
        heavyStatus[res.status] = (heavyStatus[res.status] ?? 0) + 1;
        if (res.status === 200) heavyOk++;
        // A well-behaved client backs off on 429; a noisy one barely does.
        if (res.status === 429) await new Promise((r) => setTimeout(r, 20));
      }
    };
    const lightLoop = async () => {
      let i = 0;
      while (Date.now() < until) {
        const t0 = performance.now();
        const res = await request(port, light, lightPaths[i++ % lightPaths.length]!, { token: lightToken });
        lightLatencies.push(performance.now() - t0);
        lightStatus[res.status] = (lightStatus[res.status] ?? 0) + 1;
        await new Promise((r) => setTimeout(r, 25)); // ≈ 40 requests/s of ordinary use
      }
    };
    await Promise.all([lightLoop(), ...(s.heavy ? Array.from({ length: HEAVY_CLIENTS }, (_, k) => heavyLoop(k)) : [])]);
    const st = stats(lightLatencies);
    return {
      scenario: s.id,
      label: s.label,
      light: { ...st, requests: lightLatencies.length, status: lightStatus },
      heavy: { okPerSecond: round(heavyOk / (DURATION_MS / 1000), 1), status: heavyStatus },
    };
  } finally {
    await app.close();
  }
}

async function main() {
  const owner = await connect('migrator');
  const env = await environment(owner);
  await owner.end();
  const gen = process.env.E4_REUSE ? null : await generate({ ...SHAPE, auditPerTenant: 200 });
  if (gen) console.log('generated', gen);

  const results = [];
  for (const s of SCENARIOS) {
    const r = await runScenario(s);
    console.log(JSON.stringify(r));
    results.push(r);
  }

  const base = results[0]!.light;
  const rows = results.map((r) => [
    r.scenario,
    r.label,
    round(r.light.median, 1),
    round(r.light.p95, 1),
    `${round(r.light.p95 / base.p95, 1)}×`,
    r.light.requests,
    Object.entries(r.light.status).map(([k, v]) => `${k}:${v}`).join(' '),
    r.heavy.okPerSecond,
    Object.entries(r.heavy.status).map(([k, v]) => `${k}:${v}`).join(' '),
  ]);
  const md = `
# E4: noisy neighbour

${envBlock(env)}

Light tenant: ${SHAPE.users} employees, ≈ 40 req/s of everyday reads (context, team list, cycles).
Heavy tenant: ${SHAPE.users + SHAPE.heavyUsers} employees (100×), ${HEAVY_CLIENTS} concurrent clients calling the reports, analytics
and full-list endpoints back-to-back. Same API process, same 10-connection pool, same database.
${DURATION_MS / 1000} s per scenario, a fresh application per scenario. Latencies in ms.

${table(['', 'scenario', 'light median', 'light p95', 'p95 vs alone', 'light requests', 'light status codes', 'heavy 200/s', 'heavy status codes'], rows)}

## Reading

- **S1** is the cost of a shared pool and a shared database: the light tenant waits behind the
  heavy tenant's queries for connections and CPU.
- **S2**: the per-tenant token bucket answers the heavy tenant's excess with a cheap 429 before it
  touches the database, so the light tenant's latency returns towards S0 while the heavy tenant
  still gets its fair share (its budget per minute).
- **S3**: \`statement_timeout\` (set per transaction with the tenant) additionally caps any single
  expensive statement: slow report queries of the heavy tenant now fail fast (5xx counted above)
  instead of occupying a connection.
- The limiter is in-memory per instance (ADR / over-engineering table): with R replicas the
  effective budget is R × the configured one, accepted until exact limits are required (Redis).
`;
  writeResult('e4-noisy-neighbour', { env, shape: SHAPE, durationMs: DURATION_MS, heavyClients: HEAVY_CLIENTS, results }, md);
  agent.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
