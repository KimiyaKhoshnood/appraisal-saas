/**
 * Shared measurement harness for experiments E2–E6.
 *
 * Measurement rules from the architecture document:
 *  - warm up first, then at least five repetitions; report median and p95;
 *  - record hardware and versions with every result;
 *  - results are *relative* comparisons on one laptop, never absolute capacity claims.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';

if (existsSync('.env')) process.loadEnvFile('.env');

export const BENCH_DB = process.env.BENCH_DATABASE_NAME ?? 'appraisal_bench';

export function benchUrl(kind: 'runtime' | 'migrator'): string {
  const u = new URL((kind === 'runtime' ? process.env.DATABASE_URL : process.env.MIGRATOR_DATABASE_URL)!);
  u.pathname = `/${BENCH_DB}`;
  return u.toString();
}

export async function connect(kind: 'runtime' | 'migrator'): Promise<Client> {
  const c = new Client({ connectionString: benchUrl(kind) });
  await c.connect();
  return c;
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export interface Stats {
  n: number;
  median: number;
  p95: number;
  mean: number;
}

export function stats(samples: number[]): Stats {
  const s = [...samples].sort((a, b) => a - b);
  return {
    n: s.length,
    median: round(percentile(s, 50)),
    p95: round(percentile(s, 95)),
    mean: round(s.reduce((a, b) => a + b, 0) / s.length),
  };
}

export const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

/** Times `fn` `iterations` times per run, `runs` runs, after a warm-up. Returns ms per call. */
export async function measure(fn: () => Promise<unknown>, opts: { iterations: number; runs?: number; warmup?: number }): Promise<{ perRun: Stats[]; all: Stats }> {
  const runs = opts.runs ?? 5;
  for (let i = 0; i < (opts.warmup ?? Math.ceil(opts.iterations / 5)); i++) await fn();
  const perRun: Stats[] = [];
  const all: number[] = [];
  for (let r = 0; r < runs; r++) {
    const samples: number[] = [];
    for (let i = 0; i < opts.iterations; i++) {
      const t0 = performance.now();
      await fn();
      samples.push(performance.now() - t0);
    }
    perRun.push(stats(samples));
    all.push(...samples);
  }
  return { perRun, all: stats(all) };
}

export async function environment(client: Client) {
  const pg = (await client.query<{ v: string }>("SELECT current_setting('server_version') AS v")).rows[0]!.v;
  return {
    date: new Date().toISOString(),
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cores: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 2 ** 30),
    os: `${os.platform()} ${os.release()}`,
    node: process.version,
    postgres: pg,
    note: 'PostgreSQL and the client on the same laptop (loopback); relative comparisons only.',
  };
}

const RESULTS_DIR = join(__dirname, '..', '..', '..', 'docs', 'experiments', 'results');

export function writeResult(id: string, data: unknown, markdown: string): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, `${id}.json`), JSON.stringify(data, null, 2) + '\n');
  writeFileSync(join(RESULTS_DIR, `${id}.md`), markdown.trim() + '\n');
  console.log(`\nwritten docs/experiments/results/${id}.{json,md}`);
}

export function table(head: string[], rows: (string | number)[][]): string {
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

export function envBlock(env: Awaited<ReturnType<typeof environment>>): string {
  return `_${env.date} · ${env.cpu} (${env.cores} logical cores, ${env.memoryGb} GB) · ${env.os} · Node ${env.node} · PostgreSQL ${env.postgres}. ${env.note}_`;
}
