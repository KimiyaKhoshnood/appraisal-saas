import { tenantUrl } from './lib/host';

/**
 * The bare domain hosts no tenant. In the local demo it links to the seeded organisations and
 * the platform console; in production this would be the marketing site.
 */
export default function Landing() {
  const links = [
    { name: 'Acme Robotics', slug: 'acme', note: 'ENTERPRISE · self-assessment + approval · English' },
    { name: 'Globex Logistics', slug: 'globex', note: 'BUSINESS · manager-only · Persian (RTL)' },
    { name: 'Platform console', slug: 'admin', note: 'Create and suspend tenants' },
  ];
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Appraisal SaaS</h1>
      <p className="mt-2 text-slate-600">One code base, many organisations. Each one lives on its own sub-domain.</p>
      <ul className="mt-8 space-y-3">
        {links.map((l) => (
          <li key={l.slug}>
            <a href={tenantUrl(l.slug)} className="block rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:ring-slate-400">
              <div className="font-medium">{l.name}</div>
              <div className="text-sm text-slate-500">
                {l.slug}.localhost — {l.note}
              </div>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
