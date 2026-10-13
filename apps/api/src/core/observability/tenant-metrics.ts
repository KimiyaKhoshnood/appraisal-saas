import { Injectable } from '@nestjs/common';

/**
 * Per-tenant RED metrics (rate, errors, duration), in-process and dependency-free.
 *
 * Two consumers:
 *  - `/api/metrics` in the Prometheus text format (cumulative counters and histograms; with
 *    several replicas Prometheus sums the instances),
 *  - the platform console's "tenant health" panel (a sliding five-minute window per instance).
 *
 * Cardinality is bounded on purpose: the tenant label is never combined with the route label
 * (tenants × routes would explode), routes are Express templates such as `/api/evaluations/:id`
 * (never raw URLs with ids), and at most MAX_TENANTS tenant series exist; later ones are counted
 * under `tenant="_other"`.
 */
export const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;
export const WINDOW_MINUTES = 5;
export const MAX_TENANTS = 500;
const OTHER = '_other';
/** Requests rejected before a tenant was known (no token, wrong host). */
export const UNATTRIBUTED = '_none';

type StatusClass = '2xx' | '3xx' | '4xx' | '5xx';

class Histogram {
  readonly buckets = new Array<number>(LATENCY_BUCKETS.length).fill(0);
  count = 0;
  sum = 0;

  observe(seconds: number) {
    this.count += 1;
    this.sum += seconds;
    const i = LATENCY_BUCKETS.findIndex((b) => seconds <= b);
    if (i >= 0) this.buckets[i]! += 1;
  }

  add(other: Histogram) {
    other.buckets.forEach((n, i) => (this.buckets[i]! += n));
    this.count += other.count;
    this.sum += other.sum;
  }

  /** Same estimate as PromQL `histogram_quantile`: linear interpolation inside the bucket. */
  quantile(q: number): number | null {
    if (this.count === 0) return null;
    const rank = q * this.count;
    let cumulative = 0;
    for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
      const inBucket = this.buckets[i]!;
      if (cumulative + inBucket >= rank) {
        const lower = i === 0 ? 0 : LATENCY_BUCKETS[i - 1]!;
        const upper = LATENCY_BUCKETS[i]!;
        return lower + (upper - lower) * (inBucket === 0 ? 1 : (rank - cumulative) / inBucket);
      }
      cumulative += inBucket;
    }
    return LATENCY_BUCKETS.at(-1)!; // beyond the last bucket: report its bound, as Prometheus does
  }
}

interface MinuteSlot {
  minute: number;
  requests: number;
  errors: number;
  throttled: number;
  latency: Histogram;
}

class TenantSeries {
  readonly byStatus = new Map<StatusClass, number>();
  throttled = 0;
  readonly latency = new Histogram();
  readonly window: MinuteSlot[] = [];
  lastSeen = 0;
}

export interface Observation {
  tenant: string | null;
  method: string;
  route: string;
  status: number;
  seconds: number;
  at?: number;
}

export interface TenantHealth {
  tenant: string;
  requests: number;
  requestsPerMinute: number;
  errorRate: number;
  throttled: number;
  p50Ms: number | null;
  p95Ms: number | null;
  lastSeen: string | null;
}

const statusClass = (status: number): StatusClass => (status >= 500 ? '5xx' : status >= 400 ? '4xx' : status >= 300 ? '3xx' : '2xx');
const escape = (v: string) => v.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');

@Injectable()
export class TenantMetrics {
  private readonly tenants = new Map<string, TenantSeries>();
  private readonly routes = new Map<string, number>();
  private readonly startedAt = Date.now();

  observe(o: Observation): void {
    const at = o.at ?? Date.now();
    const label = this.tenantLabel(o.tenant);
    const series = this.tenants.get(label) ?? new TenantSeries();
    this.tenants.set(label, series);

    const cls = statusClass(o.status);
    series.byStatus.set(cls, (series.byStatus.get(cls) ?? 0) + 1);
    if (o.status === 429) series.throttled += 1;
    series.latency.observe(o.seconds);
    series.lastSeen = at;

    const minute = Math.floor(at / 60_000);
    let slot = series.window.at(-1);
    if (!slot || slot.minute !== minute) {
      slot = { minute, requests: 0, errors: 0, throttled: 0, latency: new Histogram() };
      series.window.push(slot);
      while (series.window.length > WINDOW_MINUTES) series.window.shift();
    }
    slot.requests += 1;
    if (o.status >= 500) slot.errors += 1;
    if (o.status === 429) slot.throttled += 1;
    slot.latency.observe(o.seconds);

    const routeKey = `${o.method}|${o.route}|${cls}`;
    this.routes.set(routeKey, (this.routes.get(routeKey) ?? 0) + 1);
  }

  /** Sliding window (this instance), busiest tenant first. */
  health(now = Date.now()): TenantHealth[] {
    const oldest = Math.floor(now / 60_000) - WINDOW_MINUTES + 1;
    const rows: TenantHealth[] = [];
    for (const [tenant, s] of this.tenants) {
      const slots = s.window.filter((w) => w.minute >= oldest);
      const latency = new Histogram();
      slots.forEach((w) => latency.add(w.latency));
      const requests = slots.reduce((n, w) => n + w.requests, 0);
      const errors = slots.reduce((n, w) => n + w.errors, 0);
      const ms = (q: number) => {
        const v = latency.quantile(q);
        return v === null ? null : Math.round(v * 10_000) / 10;
      };
      rows.push({
        tenant,
        requests,
        requestsPerMinute: Math.round((requests / WINDOW_MINUTES) * 10) / 10,
        errorRate: requests ? errors / requests : 0,
        throttled: slots.reduce((n, w) => n + w.throttled, 0),
        p50Ms: ms(0.5),
        p95Ms: ms(0.95),
        lastSeen: s.lastSeen ? new Date(s.lastSeen).toISOString() : null,
      });
    }
    return rows.sort((a, b) => b.requests - a.requests);
  }

  /** Prometheus text exposition format 0.0.4. */
  exposition(): string {
    const out: string[] = [];
    out.push('# HELP appraisal_http_requests_total HTTP requests by tenant and status class.');
    out.push('# TYPE appraisal_http_requests_total counter');
    for (const [tenant, s] of this.tenants) {
      for (const [cls, n] of s.byStatus) out.push(`appraisal_http_requests_total{tenant="${escape(tenant)}",status="${cls}"} ${n}`);
    }
    out.push('# HELP appraisal_http_throttled_total Requests refused by the per-tenant rate limit (429).');
    out.push('# TYPE appraisal_http_throttled_total counter');
    for (const [tenant, s] of this.tenants) out.push(`appraisal_http_throttled_total{tenant="${escape(tenant)}"} ${s.throttled}`);
    out.push('# HELP appraisal_http_request_duration_seconds Request latency by tenant.');
    out.push('# TYPE appraisal_http_request_duration_seconds histogram');
    for (const [tenant, s] of this.tenants) {
      const t = escape(tenant);
      let cumulative = 0;
      LATENCY_BUCKETS.forEach((le, i) => {
        cumulative += s.latency.buckets[i]!;
        out.push(`appraisal_http_request_duration_seconds_bucket{tenant="${t}",le="${le}"} ${cumulative}`);
      });
      out.push(`appraisal_http_request_duration_seconds_bucket{tenant="${t}",le="+Inf"} ${s.latency.count}`);
      out.push(`appraisal_http_request_duration_seconds_sum{tenant="${t}"} ${s.latency.sum}`);
      out.push(`appraisal_http_request_duration_seconds_count{tenant="${t}"} ${s.latency.count}`);
    }
    out.push('# HELP appraisal_http_route_requests_total HTTP requests by route template (all tenants).');
    out.push('# TYPE appraisal_http_route_requests_total counter');
    for (const [key, n] of this.routes) {
      const [method, route, cls] = key.split('|');
      out.push(`appraisal_http_route_requests_total{method="${method}",route="${escape(route!)}",status="${cls}"} ${n}`);
    }
    out.push('# HELP appraisal_process_uptime_seconds Seconds since this instance started.');
    out.push('# TYPE appraisal_process_uptime_seconds gauge');
    out.push(`appraisal_process_uptime_seconds ${Math.round((Date.now() - this.startedAt) / 1000)}`);
    return `${out.join('\n')}\n`;
  }

  private tenantLabel(tenant: string | null): string {
    if (!tenant) return UNATTRIBUTED;
    if (this.tenants.has(tenant) || this.tenants.size < MAX_TENANTS) return tenant;
    return OTHER;
  }
}
