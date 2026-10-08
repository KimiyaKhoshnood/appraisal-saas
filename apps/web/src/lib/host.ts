/**
 * Which application this page is: the sub-domain decides (ADR-003). Pure presentation: the API
 * re-derives and cross-checks the tenant on every request.
 */
export type AppKind = { kind: 'tenant'; slug: string } | { kind: 'platform' } | { kind: 'landing' };

export function detectApp(hostname: string = window.location.hostname): AppKind {
  const labels = hostname.toLowerCase().split('.');
  // <slug>.localhost or <slug>.<domain>.<tld>
  const isLocal = labels.at(-1) === 'localhost';
  const tenantLabels = isLocal ? labels.length - 1 : labels.length - 2;
  if (tenantLabels !== 1) return { kind: 'landing' };
  const label = labels[0]!;
  if (label === 'admin') return { kind: 'platform' };
  return { kind: 'tenant', slug: label };
}

/** URL of a tenant's app on the current base domain and port. */
export function tenantUrl(slug: string): string {
  const { protocol, port, hostname } = window.location;
  const labels = hostname.split('.');
  const base = detectApp(hostname).kind === 'landing' ? hostname : labels.slice(1).join('.');
  return `${protocol}//${slug}.${base}${port ? `:${port}` : ''}/`;
}
