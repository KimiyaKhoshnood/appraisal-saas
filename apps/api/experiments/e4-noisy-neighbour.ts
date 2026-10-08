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

  const REPEATS = Number(process.env.E4_REPEATS ?? 3);
  const runs: Awaited<ReturnType<typeof runScenario>>[] = [];
  // Scenarios interleaved per repetition so slow drift (thermal, OS) hits all of them equally.
  for (let rep = 1; rep <= REPEATS; rep++) {
    for (const s of SCENARIOS) {
      const r = await runScenario(s);
      console.log(`rep ${rep}`, JSON.stringify(r));
      runs.push(r);
    }
  }
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const sumStatus = (xs: Record<number, number>[]) =>
    xs.reduce<Record<string, number>>((acc, st) => {
      for (const [k, v] of Object.entries(st)) acc[k] = (acc[k] ?? 0) + v;
      return acc;
    }, {});
  const results = SCENARIOS.map((sc) => {
    const rs = runs.filter((r) => r.scenario === sc.id);
    return {
      scenario: sc.id,
      label: sc.label,
      medianMs: med(rs.map((r) => r.light.median)),
      p95Ms: med(rs.map((r) => r.light.p95)),
      p95Range: [Math.min(...rs.map((r) => r.light.p95)), Math.max(...rs.map((r) => r.light.p95))],
      lightStatus: sumStatus(rs.map((r) => r.light.status)),
      heavyOkPerSecond: med(rs.map((r) => r.heavy.okPerSecond)),
      heavyStatus: sumStatus(rs.map((r) => r.heavy.status)),
    };
  });
  const base = results[0]!;
  const fmt = (st: Record<string, number>) => Object.entries(st).map(([k, v]) => `${k}:${v}`).join(' ');
  const rows = results.map((r) => [
    r.scenario,
    r.label,
    round(r.medianMs, 1),
    round(r.p95Ms, 1),
    `${round(r.p95Range[0]!, 0)}–${round(r.p95Range[1]!, 0)}`,
    `${round(r.p95Ms / base.p95Ms, 1)}×`,
    fmt(r.lightStatus),
    r.heavyOkPerSecond,
    fmt(r.heavyStatus),
  ]);
  const md = `
# E4: noisy neighbour

${envBlock(env)}

Light tenant: ${SHAPE.users} employees, ≈ 40 req/s of everyday reads (context, team list, cycles).
Heavy tenant: ${SHAPE.users + SHAPE.heavyUsers} employees (100×), ${HEAVY_CLIENTS} concurrent clients calling the reports, analytics
and full-list endpoints back-to-back. Same API process, same 10-connection pool, same database.
${DURATION_MS / 1000} s per scenario, a fresh application per scenario, ${REPEATS} interleaved repetitions; medians across
repetitions, latencies in ms.

${table(['', 'scenario', 'light median', 'light p95', 'p95 range over runs', 'p95 vs alone', 'light status codes (all runs)', 'heavy 200/s', 'heavy status codes (all runs)'], rows)}

## Reading

- **S1 shows the price of shared resources**: with no controls the heavy tenant occupies the
  10-connection pool and the CPU, and the light tenant's p95 grows by one to two orders of
  magnitude. The spread between repetitions is large: contention is bursty.
- **S2, per-tenant rate limit**: the heavy tenant's excess is answered with a cheap 429 before it
  reaches the database, and the light tenant's latency falls substantially. (The first version of
  the limiter allowed a burst of a full minute's budget and did not fire within a 20 s run; the
  burst is now ten seconds' worth.)
- **S3, plus statement_timeout**: expensive statements are cut after 150 ms and answered 503 +
  Retry-After, so no single query holds a connection for long; the light tenant's tail improves
  further.
- **Not solved**: even with both controls the light tenant stays well above its stand-alone
  latency, because the heavy tenant's *permitted* share still competes for the same pool and CPU.
  Fully isolating a heavy tenant needs separate capacity: a per-tenant connection budget or
  moving it to its own database through \`tenant_directory\`, the documented growth path.
- The limiter is in-memory per instance: with R replicas the effective budget is R × the
  configured one, accepted until exact limits are required (Redis).
`;
  writeResult('e4-noisy-neighbour', { env, shape: SHAPE, durationMs: DURATION_MS, heavyClients: HEAVY_CLIENTS, repeats: REPEATS, results, runs }, md);
  agent.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
