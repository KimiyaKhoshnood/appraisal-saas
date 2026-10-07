/**
 * Small bounded in-process cache. Used only for configuration, permissions and tenant
 * status, always with keys that include the tenant id and (where it matters) a version
 * number read from the database, so replicas never need an invalidation bus (ADR-006).
 * Evaluation data is never cached (T10).
 */
export class TtlCache<V> {
  private readonly map = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency (Map keeps insertion order → cheap LRU).
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  async getOrLoad(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = await load();
    this.set(key, value);
    return value;
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  deleteWhere(predicate: (key: string) => boolean): void {
    for (const key of this.map.keys()) if (predicate(key)) this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }
}
