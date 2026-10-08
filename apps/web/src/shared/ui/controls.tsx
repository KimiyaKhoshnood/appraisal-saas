import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '../lib/cn';
import { useI18n } from '../i18n/i18n';
import { spring } from './motion';

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn('flex items-center gap-3 text-sm', disabled ? 'opacity-55' : 'cursor-pointer')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('focus-ring relative flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors', checked ? 'justify-end bg-brand' : 'justify-start bg-zinc-300 dark:bg-zinc-700')}
      >
        <motion.span layout transition={spring} className="size-5 rounded-full bg-white shadow-sm" />
      </button>
      <span className="text-fg">{label}</span>
    </label>
  );
}

/**
 * Rating input: one button per scale value, with an animated selection pill. Faster and more
 * honest than a dropdown (all options visible, keyboard and screen-reader friendly radiogroup).
 */
export function Rating({
  value,
  min,
  max,
  onChange,
  label,
  disabled,
}: {
  value: number | '';
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  disabled?: boolean;
}) {
  const { formatNumber } = useI18n();
  const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-xl bg-surface-2 p-1">
      {values.map((v) => {
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(v)}
            className={cn(
              'focus-ring relative grid size-8 place-items-center rounded-lg text-sm font-medium tabular transition-colors',
              active ? 'text-white' : 'text-muted hover:text-fg',
            )}
          >
            {active && <motion.span layoutId={`rating-${label}`} transition={spring} className="absolute inset-0 rounded-lg bg-brand shadow-sm" />}
            <span className="relative">{formatNumber(v)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, id }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; id: string }) {
  return (
    <div className="inline-flex rounded-xl bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn('focus-ring relative rounded-lg px-3 py-1.5 text-xs font-medium transition-colors', value === o.value ? 'text-fg' : 'text-muted hover:text-fg')}
        >
          {value === o.value && <motion.span layoutId={`seg-${id}`} transition={spring} className="absolute inset-0 rounded-lg bg-surface shadow-sm ring-1 ring-line" />}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
  // Stable hue per name: same person, same colour, everywhere.
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center rounded-full font-semibold text-white', size === 'sm' ? 'size-7 text-[10px]' : 'size-9 text-xs')}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 65% 55%), hsl(${(hue + 40) % 360} 60% 45%))` }}
    >
      {initials}
    </span>
  );
}
