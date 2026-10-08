import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { stagger } from './motion';

/** Every page enters with the same soft stagger; children use the `fadeUp` variant. */
export function Page({ children }: { children: ReactNode }) {
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
      {children}
    </motion.div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <motion.div variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }} className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium tracking-wide text-brand-text uppercase">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-fg md:text-[1.7rem]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </motion.div>
  );
}
