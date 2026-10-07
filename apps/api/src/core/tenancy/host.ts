export type HostKind = { kind: 'tenant'; slug: string } | { kind: 'platform' } | { kind: 'none' };

export const PLATFORM_SUBDOMAIN = 'admin';

/**
 * Classifies a request host against BASE_DOMAIN. The result is a *hint*: it selects the login
 * page before a token exists and is cross-checked with the token afterwards. It is never by
 * itself the basis of an authorisation decision (ADR-003).
 */
export function classifyHost(hostname: string | undefined, baseDomain: string): HostKind {
  if (!hostname) return { kind: 'none' };
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const base = baseDomain.toLowerCase();
  if (host === base || !host.endsWith(`.${base}`)) return { kind: 'none' };
  const label = host.slice(0, -(base.length + 1));
  if (label.includes('.')) return { kind: 'none' }; // exactly one label: a.b.base is not a tenant
  if (label === PLATFORM_SUBDOMAIN) return { kind: 'platform' };
  return { kind: 'tenant', slug: label };
}

/** CORS: only the platform's own sub-domains (any port in development). */
export function isAllowedOrigin(origin: string, baseDomain: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const kind = classifyHost(url.hostname, baseDomain);
  return kind.kind !== 'none' || url.hostname === baseDomain;
}
