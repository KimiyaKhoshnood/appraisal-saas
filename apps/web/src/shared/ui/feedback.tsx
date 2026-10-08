import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { Inbox, RotateCcw, TriangleAlert } from 'lucide-react';
import { ApiError } from '../lib/api';
import { useI18n } from '../i18n/i18n';
import { Button } from './button';
import { SkeletonRows } from './skeleton';

export function EmptyState({ title, hint, icon, action }: { title: string; hint?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-3 py-12 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand-text">{icon ?? <Inbox className="size-5" />}</div>
      <div>
        <p className="text-sm font-medium text-fg">{title}</p>
        {hint && <p className="mt-1 max-w-sm text-sm text-muted">{hint}</p>}
      </div>
      {action}
    </motion.div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: (() => void) | undefined }) {
  const { t } = useI18n();
  const api = error instanceof ApiError ? error : null;
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-red-500/25 bg-red-500/[0.06] p-4 text-sm text-red-800 dark:text-red-300"
    >
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{api?.message ?? t('app.error')}</p>
          {api?.problem.errors?.length ? (
            <ul className="mt-2 space-y-0.5 text-xs">
              {api.problem.errors.map((e) => (
                <li key={e.path + e.message}>
                  <code className="rounded bg-red-500/10 px-1">{e.path}</code> {e.message}
                </li>
              ))}
            </ul>
          ) : null}
          {api?.problem.requestId && (
            <p className="mt-2 text-xs opacity-70">
              {t('app.requestId')}: <code>{api.problem.requestId}</code>
            </p>
          )}
        </div>
        {onRetry && (
          <Button size="sm" variant="secondary" icon={<RotateCcw className="size-3.5" />} onClick={onRetry}>
            {t('app.retry')}
          </Button>
        )}
      </div>
    </motion.div>
  );
}

/** FE-03: every data view handles loading (skeleton), error (problem details) and empty. */
export function QueryState({
  isLoading,
  error,
  isEmpty,
  onRetry,
  skeleton,
  empty,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  isEmpty?: boolean;
  onRetry?: () => void;
  skeleton?: ReactNode;
  empty?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  if (isLoading) return <>{skeleton ?? <SkeletonRows />}</>;
  if (error) return <ErrorBox error={error} onRetry={onRetry} />;
  if (isEmpty) return <>{empty ?? <EmptyState title={t('app.empty')} />}</>;
  return <>{children}</>;
}
