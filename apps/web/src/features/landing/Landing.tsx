import { motion } from 'motion/react';
import { ArrowRight, Building2, Languages, ServerCog, ShieldCheck } from 'lucide-react';
import { tenantUrl } from '../../shared/lib/host';
import { fadeUp, stagger } from '../../shared/ui';
import { Aurora } from '../auth/LoginPage';

/**
 * The bare domain hosts no tenant. In the local demo it links to the seeded organisations and
 * the platform console; in production this would be the marketing site.
 */
export default function Landing() {
  const links = [
    { name: 'Acme Robotics', slug: 'acme', note: 'Enterprise · self-assessment + approval · English', icon: <Building2 className="size-5" />, colors: 'from-blue-600 to-teal-600' },
    { name: 'Globex Logistics', slug: 'globex', note: 'Business · manager-only results · Persian, RTL', icon: <Languages className="size-5" />, colors: 'from-amber-600 to-violet-600' },
    { name: 'Platform console', slug: 'admin', note: 'Create, suspend and re-plan tenants', icon: <ServerCog className="size-5" />, colors: 'from-indigo-600 to-teal-600' },
  ];
  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-950 text-white [--brand:#4f46e5] [--brand-2:#0f766e]">
      <Aurora />
      <motion.main variants={stagger} initial="hidden" animate="show" className="relative mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
        <motion.p variants={fadeUp} className="inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80 ring-1 ring-white/15 backdrop-blur">
          <ShieldCheck className="size-3.5" /> Shared schema · Row-Level Security · one code base
        </motion.p>
        <motion.h1 variants={fadeUp} className="mt-6 max-w-3xl text-5xl leading-[1.05] font-semibold tracking-tight md:text-6xl">
          One product.
          <br />
          <span className="bg-gradient-to-r from-white via-white/80 to-white/50 bg-clip-text text-transparent">Every organisation its own.</span>
        </motion.h1>
        <motion.p variants={fadeUp} className="mt-5 max-w-xl text-lg text-white/70">
          A multi-tenant performance appraisal platform. Each organisation lives on its own sub-domain, with its own brand, language and rules.
        </motion.p>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {links.map((l) => (
            <motion.a
              key={l.slug}
              variants={fadeUp}
              whileHover={{ y: -4 }}
              href={tenantUrl(l.slug)}
              className="group rounded-2xl bg-white/[0.06] p-5 ring-1 ring-white/10 backdrop-blur-xl transition-colors hover:bg-white/[0.1]"
            >
              <span className={`grid size-10 place-items-center rounded-xl bg-gradient-to-br ${l.colors}`}>{l.icon}</span>
              <div className="mt-4 flex items-center justify-between font-semibold">
                {l.name}
                <ArrowRight className="size-4 opacity-60 transition-transform group-hover:translate-x-1" />
              </div>
              <div className="mt-1 text-xs text-white/60">{l.slug}.localhost</div>
              <div className="mt-3 text-sm text-white/70">{l.note}</div>
            </motion.a>
          ))}
        </div>
      </motion.main>
    </div>
  );
}
