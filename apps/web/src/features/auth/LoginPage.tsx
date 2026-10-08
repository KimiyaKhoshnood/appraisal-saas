import { useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, CircleCheck, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useI18n } from '../../shared/i18n/i18n';
import { ApiError } from '../../shared/lib/api';
import { Button, Field, Input, fadeUp, stagger } from '../../shared/ui';

/** Animated brand aurora: three blurred blobs in the tenant's colours (CSS animation, GPU only). */
export function Aurora({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <div className="absolute -top-1/3 -start-1/4 size-[70%] animate-aurora rounded-full bg-brand opacity-60 blur-3xl" />
      <div className="absolute -bottom-1/3 -end-1/4 size-[70%] animate-aurora rounded-full bg-brand-2 opacity-50 blur-3xl [animation-delay:-6s]" />
      <div className="absolute top-1/4 start-1/3 size-[45%] animate-aurora rounded-full bg-white opacity-10 blur-3xl [animation-delay:-11s]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.12)_1px,transparent_0)] [background-size:22px_22px]" />
    </div>
  );
}

export function AuthLayout({ hero, children }: { hero: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-bg lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-zinc-950 lg:block">
        <Aurora />
        <motion.div variants={stagger} initial="hidden" animate="show" className="relative flex h-full flex-col justify-between p-12 text-white">
          {hero}
        </motion.div>
      </div>
      <div className="relative flex items-center justify-center p-6">
        <div className="absolute inset-0 overflow-hidden lg:hidden">
          <Aurora className="opacity-30" />
        </div>
        {children}
      </div>
    </div>
  );
}

export function LoginForm({
  title,
  subtitle,
  logo,
  onSubmit,
  footer,
}: {
  title: string;
  subtitle: string;
  logo: ReactNode;
  onSubmit: (email: string, password: string) => Promise<void>;
  footer?: ReactNode;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(email, password);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? t('auth.throttled') : t('auth.invalid'));
      setShake((s) => s + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.form
      key={shake}
      onSubmit={submit}
      initial={shake ? { x: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
      animate={shake ? { x: [0, -10, 10, -6, 6, 0] } : { opacity: 1, y: 0, scale: 1 }}
      transition={shake ? { duration: 0.4 } : { type: 'spring', stiffness: 260, damping: 26 }}
      className="relative w-full max-w-sm space-y-6 rounded-3xl border border-line bg-surface/90 p-8 shadow-pop backdrop-blur-xl"
    >
      <div className="space-y-4">
        {logo}
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-4">
        <Field label={t('app.email')}>
          {(id) => (
            <div className="relative">
              <Mail className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input id={id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 ps-9" />
            </div>
          )}
        </Field>
        <Field label={t('auth.password')}>
          {(id) => (
            <div className="relative">
              <Lock className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 ps-9" />
            </div>
          )}
        </Field>
      </div>
      <AnimatePresence>
        {error && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden rounded-xl bg-red-500/10 px-3 py-2.5 text-sm text-red-700 dark:text-red-300"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
      <Button type="submit" size="lg" busy={busy} className="group w-full">
        {t('auth.signIn')}
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
      </Button>
      {footer}
    </motion.form>
  );
}

export function HeroPoints({ heading, tagline, points, footnote }: { heading: ReactNode; tagline: string; points: string[]; footnote: string }) {
  return (
    <>
      <motion.div variants={fadeUp}>{heading}</motion.div>
      <div className="max-w-md space-y-8">
        <motion.h2 variants={fadeUp} className="text-4xl leading-tight font-semibold tracking-tight">
          {tagline}
        </motion.h2>
        <ul className="space-y-3">
          {points.map((p) => (
            <motion.li key={p} variants={fadeUp} className="flex items-center gap-3 text-white/85">
              <CircleCheck className="size-5 shrink-0 text-white" />
              {p}
            </motion.li>
          ))}
        </ul>
      </div>
      <motion.p variants={fadeUp} className="flex items-center gap-2 text-xs text-white/60">
        <ShieldCheck className="size-4" />
        {footnote}
      </motion.p>
    </>
  );
}
