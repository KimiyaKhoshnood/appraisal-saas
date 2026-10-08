import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '../lib/cn';
import { CountUp } from './count-up';
import { fadeUp } from './motion';

export function Stat({
  label,
  value,
  decimals = 0,
  icon,
  hint,
  accent,
}: {
  label: string;
  value: number | null;
  decimals?: number;
  icon?: ReactNode;
  hint?: ReactNode;
  accent?: boolean;
}) {
  return (
    <motion.div
      variants={fadeUp}
      whileHover={{ y: -2 }}
      className={cn(
        'relative overflow-hidden rounded-2xl border border-line bg-surface p-4 shadow-card',
        accent && 'border-transparent bg-gradient-to-br from-brand to-brand-2 text-white',
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn('text-xs font-medium', accent ? 'text-white/80' : 'text-muted')}>{label}</span>
        {icon && <span className={cn('opacity-70', accent ? 'text-white' : 'text-brand-text')}>{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular">{value === null ? '—' : <CountUp value={value} decimals={decimals} />}</div>
      {hint && <div className={cn('mt-1 text-xs', accent ? 'text-white/75' : 'text-muted')}>{hint}</div>}
    </motion.div>
  );
}
