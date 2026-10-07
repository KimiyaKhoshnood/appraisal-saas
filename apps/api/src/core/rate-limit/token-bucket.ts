/**
 * Token-bucket limiter keyed by an arbitrary string (tenant id, or tenant+ip+email for login).
 *
 * In-memory per instance by design: with N replicas the effective limit is up to N× the
 * configured one. The architecture accepts that imprecision; Redis is introduced only when
 * exact cross-replica limits become a requirement (see docs, "Over-engineering").
 */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 50_000,
  ) {}

  /** Returns 0 when allowed, otherwise the number of seconds to wait. */
  take(key: string, cost = 1): number {
    if (this.capacity <= 0) return 0; // disabled
    const t = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) this.evictFull(t);
      bucket = { tokens: this.capacity, updatedAt: t };
      this.buckets.set(key, bucket);
    }
    const elapsed = (t - bucket.updatedAt) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerSecond);
    bucket.updatedAt = t;
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return 0;
    }
    return Math.max(1, Math.ceil((cost - bucket.tokens) / this.refillPerSecond));
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private evictFull(t: number): void {
    for (const [key, b] of this.buckets) {
      const tokens = b.tokens + ((t - b.updatedAt) / 1000) * this.refillPerSecond;
      if (tokens >= this.capacity) this.buckets.delete(key);
    }
    if (this.buckets.size >= this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
  }
}
