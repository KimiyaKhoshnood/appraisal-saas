import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';

const TONES: Record<string, string> = {
  DRAFT: 'bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-300',
  SELF_SUBMITTED: 'bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300',
  MANAGER_SUBMITTED: 'bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300',
  PENDING_APPROVAL: 'bg-orange-500/10 text-orange-700 ring-orange-500/25 dark:text-orange-300',
  PUBLISHED: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300',
  ACTIVE: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300',
  CLOSED: 'bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-300',
  SUSPENDED: 'bg-red-500/10 text-red-700 ring-red-500/25 dark:text-red-300',
  PROVISIONING: 'bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300',
  SECURITY: 'bg-red-500/10 text-red-700 ring-red-500/25 dark:text-red-300',
  CHANGE: 'bg-violet-500/10 text-violet-700 ring-violet-500/25 dark:text-violet-300',
  BRAND: 'bg-brand-soft text-brand-text ring-brand-ring/30',
  NEUTRAL: 'bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:text-zinc-300',
};

const DOT: Record<string, string> = {
  DRAFT: 'bg-zinc-400',
  SELF_SUBMITTED: 'bg-sky-500',
  MANAGER_SUBMITTED: 'bg-amber-500',
  PENDING_APPROVAL: 'bg-orange-500',
  PUBLISHED: 'bg-emerald-500',
  ACTIVE: 'bg-emerald-500',
  SUSPENDED: 'bg-red-500',
};

export function Badge({ tone = 'NEUTRAL', children, dot }: { tone?: string; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', TONES[tone] ?? TONES.NEUTRAL)}>
      {dot && <span className={cn('size-1.5 rounded-full', DOT[tone] ?? 'bg-zinc-400')} />}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <Badge tone={status} dot>
      {t(`status.${status}` as MessageKey)}
    </Badge>
  );
}
