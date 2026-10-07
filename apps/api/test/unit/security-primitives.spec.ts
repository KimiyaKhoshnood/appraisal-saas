import { TokenBucketLimiter, TtlCache, classifyHost, isAllowedOrigin, loadEnv, parseOpaqueToken, safeEqualHex, sha256 } from '../../src/core';
import { sanitizeMetadata } from '../../src/modules/audit';
import { csvCell } from '../../src/modules/reporting';

describe('host classification (ADR-003)', () => {
  it.each([
    ['acme.localhost', { kind: 'tenant', slug: 'acme' }],
    ['ACME.localhost.', { kind: 'tenant', slug: 'acme' }],
    ['admin.localhost', { kind: 'platform' }],
    ['localhost', { kind: 'none' }],
    ['a.b.localhost', { kind: 'none' }],
    ['acme.evil.com', { kind: 'none' }],
    ['evillocalhost', { kind: 'none' }],
    [undefined, { kind: 'none' }],
  ])('%s → %o', (host, expected) => {
    expect(classifyHost(host, 'localhost')).toEqual(expected);
  });

  it('CORS allows only the platform’s own sub-domains', () => {
    expect(isAllowedOrigin('http://acme.localhost:5173', 'localhost')).toBe(true);
    expect(isAllowedOrigin('https://admin.localhost', 'localhost')).toBe(true);
    expect(isAllowedOrigin('https://acme.localhost.evil.com', 'localhost')).toBe(false);
    expect(isAllowedOrigin('javascript:alert(1)', 'localhost')).toBe(false);
    expect(isAllowedOrigin('not a url', 'localhost')).toBe(false);
  });
});

describe('token bucket (T9, T13)', () => {
  it('allows a burst up to capacity then asks to wait, and refills over time', () => {
    let now = 0;
    const limiter = new TokenBucketLimiter(3, 1, () => now);
    expect([limiter.take('k'), limiter.take('k'), limiter.take('k')]).toEqual([0, 0, 0]);
    expect(limiter.take('k')).toBe(1);
    expect(limiter.take('other')).toBe(0); // buckets are independent: one tenant cannot drain another
    now += 2000;
    expect(limiter.take('k')).toBe(0);
  });

  it('capacity 0 disables limiting', () => {
    const limiter = new TokenBucketLimiter(0, 0);
    for (let i = 0; i < 100; i++) expect(limiter.take('k')).toBe(0);
  });
});

describe('TTL cache', () => {
  it('expires, evicts least recently used, and loads once', async () => {
    let now = 0;
    const cache = new TtlCache<number>(1000, 2, () => now);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3); // evicts b (least recently used)
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    now += 1001;
    expect(cache.get('a')).toBeUndefined();
    let loads = 0;
    const load = async () => ++loads;
    await cache.getOrLoad('x', load);
    await cache.getOrLoad('x', load);
    expect(loads).toBe(1);
  });
});

describe('opaque refresh tokens', () => {
  it('parses only well-formed tokens', () => {
    const id = '01960000-0000-7000-8000-000000000001';
    expect(parseOpaqueToken(`${id}.${'s'.repeat(43)}`)).toEqual({ id, secret: 's'.repeat(43) });
    expect(parseOpaqueToken(undefined)).toBeNull();
    expect(parseOpaqueToken('nodot')).toBeNull();
    expect(parseOpaqueToken(`${id}.short`)).toBeNull();
    expect(parseOpaqueToken(`not-a-uuid.${'s'.repeat(43)}`)).toBeNull();
  });

  it('compares hashes in constant time and length-safely', () => {
    expect(safeEqualHex(sha256('a'), sha256('a'))).toBe(true);
    expect(safeEqualHex(sha256('a'), sha256('b'))).toBe(false);
    expect(safeEqualHex(sha256('a'), 'abcd')).toBe(false);
  });
});

describe('privacy and output hygiene', () => {
  it('audit metadata never stores scores, comments or secrets (NF-06)', () => {
    expect(sanitizeMetadata({ changed: ['a'], score: 5, comment: 'x', nested: { password: 'p', ok: 1 }, scores: [1] })).toEqual({
      changed: ['a'],
      nested: { ok: 1 },
    });
  });

  it('neutralises CSV formula injection', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell(null)).toBe('""');
    expect(csvCell(42.5)).toBe('"42.5"');
  });
});

describe('environment validation (fail at boot, not at runtime)', () => {
  const base = { DATABASE_URL: 'postgres://x', TENANT_JWT_SECRET: 't'.repeat(32), PLATFORM_JWT_SECRET: 'p'.repeat(32) };

  it('accepts a minimal valid environment with safe defaults', () => {
    const env = loadEnv(base);
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.TENANCY_APP_FILTER).toBe('on');
  });

  it('refuses identical tenant/platform keys and short secrets', () => {
    expect(() => loadEnv({ ...base, PLATFORM_JWT_SECRET: base.TENANT_JWT_SECRET })).toThrow(/differ/);
    expect(() => loadEnv({ ...base, TENANT_JWT_SECRET: 'short' })).toThrow(/TENANT_JWT_SECRET/);
  });

  it('refuses to disable isolation layer 2 or secure cookies in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', TENANCY_APP_FILTER: 'off' })).toThrow(/TENANCY_APP_FILTER/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
  });
});
