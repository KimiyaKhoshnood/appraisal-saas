import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { ApiError } from '../lib/api';
import { useI18n } from '../i18n/i18n';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:brightness-110 disabled:opacity-50',
  secondary: 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:opacity-50',
  ghost: 'text-slate-700 hover:bg-slate-100 disabled:opacity-50',
};

export function Button({
  variant = 'primary',
  busy,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={cx(
        'focus-ring inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition',
        VARIANTS[variant],
        className,
      )}
    >
      {busy && <Spinner small />}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl bg-white shadow-sm ring-1 ring-slate-200', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <div className="flex gap-2">{actions}</div>
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string | undefined; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

const control = 'focus-ring block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-xs disabled:bg-slate-100';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(control, props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(control, props.className)} />;
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('flex items-center gap-3 text-sm', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('focus-ring relative h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-brand' : 'bg-slate-300')}
      >
        <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'start-5.5' : 'start-0.5')} />
      </button>
      <span>{label}</span>
    </label>
  );
}

const BADGE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  SELF_SUBMITTED: 'bg-sky-100 text-sky-800',
  MANAGER_SUBMITTED: 'bg-amber-100 text-amber-900',
  PENDING_APPROVAL: 'bg-orange-100 text-orange-900',
  PUBLISHED: 'bg-emerald-100 text-emerald-800',
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  CLOSED: 'bg-slate-200 text-slate-700',
  SUSPENDED: 'bg-red-100 text-red-800',
  PROVISIONING: 'bg-sky-100 text-sky-800',
  SECURITY: 'bg-red-100 text-red-800',
  CHANGE: 'bg-indigo-100 text-indigo-800',
};

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={cx('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', BADGE[tone] ?? 'bg-slate-100 text-slate-700')}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <Badge tone={status}>{t(`status.${status}` as Parameters<typeof t>[0])}</Badge>;
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx('inline-block animate-spin rounded-full border-2 border-current border-e-transparent', small ? 'size-4' : 'size-6')}
    />
  );
}

/** FE-03: loading / error / empty, the three states every data view handles. */
export function QueryState({
  isLoading,
  error,
  isEmpty,
  onRetry,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  isEmpty?: boolean;
  onRetry?: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  if (isLoading)
    return (
      <div role="status" className="flex items-center gap-3 py-10 text-slate-500">
        <Spinner /> {t('app.loading')}
      </div>
    );
  if (error) return <ErrorBox error={error} onRetry={onRetry} />;
  if (isEmpty) return <p className="py-10 text-center text-sm text-slate-500">{t('app.empty')}</p>;
  return <>{children}</>;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: (() => void) | undefined }) {
  const { t } = useI18n();
  const api = error instanceof ApiError ? error : null;
  return (
    <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-200">
      <p className="font-medium">{api?.message ?? t('app.error')}</p>
      {api?.problem.errors?.length ? (
        <ul className="mt-2 list-disc ps-5">
          {api.problem.errors.map((e) => (
            <li key={e.path + e.message}>
              <code>{e.path}</code>: {e.message}
            </li>
          ))}
        </ul>
      ) : null}
      {api?.problem.requestId && (
        <p className="mt-2 text-xs text-red-700/80">
          {t('app.requestId')}: <code>{api.problem.requestId}</code>
        </p>
      )}
      {onRetry && (
        <Button variant="secondary" className="mt-3" onClick={onRetry}>
          {t('app.retry')}
        </Button>
      )}
    </div>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-start text-sm">
        <thead className="border-b border-slate-200 text-xs text-slate-500 uppercase">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 text-start font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cx('px-3 py-2.5 align-middle', className)}>{children}</td>;
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

export { cx };
