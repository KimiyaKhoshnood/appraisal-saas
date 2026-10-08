import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '../lib/cn';
import { fadeUp } from './motion';

export function Card({
  title,
  description,
  actions,
  icon,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <motion.section variants={fadeUp} className={cn('rounded-2xl border border-line bg-surface shadow-card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {icon && <span className="grid size-8 place-items-center rounded-lg bg-brand-soft text-brand-text">{icon}</span>}
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-fg">{title}</h2>
              {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(padded && 'p-5')}>{children}</div>
    </motion.section>
  );
}
