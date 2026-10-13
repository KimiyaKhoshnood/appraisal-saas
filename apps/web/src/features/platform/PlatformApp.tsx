import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Toaster, toast } from 'sonner';
import { Activity, Building2, ExternalLink, LogOut, Moon, Plus, Rocket, ScrollText, ServerCog, Sun, Timer } from 'lucide-react';
import { PLAN_CODES, PLANS, type CreateTenantInput, type Page as PageOf, type TenantSummary } from '@appraisal/contracts';
import { I18nProvider, useI18n } from '../../shared/i18n/i18n';
import { ApiError, platformApi } from '../../shared/lib/api';
import { cn } from '../../shared/lib/cn';
import { useColorMode } from '../../shared/lib/color-mode';
import { tenantUrl } from '../../shared/lib/host';
import { qk } from '../../shared/lib/query-keys';
import { applyBranding } from '../../shared/lib/theme';
import {
  Badge,
  Button,
  Card,
  CountUp,
  ErrorBox,
  Field,
  Input,
  Page,
  PageHeader,
  QueryState,
  Segmented,
  Select,
  SkeletonCards,
  StatusBadge,
  Table,
  Td,
  Toggle,
  Tr,
  fadeUp,
  spring,
} from '../../shared/ui';
import { AuthLayout, HeroPoints, LoginForm } from '../auth/LoginPage';

const CONSOLE_BRANDING = { appName: 'Platform console', primaryColor: '#4f46e5', secondaryColor: '#0f766e', locale: 'en' as const };

export default function PlatformApp() {
  const [phase, setPhase] = useState<'booting' | 'anonymous' | 'ready'>('booting');
  useEffect(() => {
    applyBranding(CONSOLE_BRANDING);
    platformApi.onSessionLost = () => setPhase('anonymous');
    void platformApi.refresh().then((ok) => setPhase(ok ? 'ready' : 'anonymous'));
  }, []);
  return (
    <I18nProvider locale="en">
      {phase === 'booting' ? null : phase === 'anonymous' ? (
        <AuthLayout
          hero={
            <HeroPoints
              heading={
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-xl bg-white/15">
                    <ServerCog className="size-5" />
                  </span>
                  <span className="text-lg font-semibold">Platform console</span>
                </div>
              }
              tagline="Every organisation is a row, not a deployment."
              points={['Provision a tenant in one transaction', 'Suspend or change plan instantly', 'No access to any tenant’s evaluation data']}
              footnote="Separate identity, key and audience from every tenant (ADR-005)"
            />
          }
        >
          <LoginForm
            title="Operator sign-in"
            subtitle="Platform operators only. Organisation users sign in on their own address, e.g. acme.localhost."
            logo={
              <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-brand to-brand-2 text-white shadow-md shadow-brand/30">
                <ServerCog className="size-6" />
              </span>
            }
            onSubmit={async (e, p) => {
              await platformApi.login(e, p);
              setPhase('ready');
            }}
          />
        </AuthLayout>
      ) : (
        <Console onLogout={() => setPhase('anonymous')} />
      )}
      <ToasterThemed />
    </I18nProvider>
  );
}

function ToasterThemed() {
  const { resolved } = useColorMode();
  return <Toaster theme={resolved} position="bottom-right" richColors closeButton />;
}

type Tab = 'tenants' | 'new' | 'audit';

function Console({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('tenants');
  const { resolved, toggle } = useColorMode();
  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'tenants', label: 'Tenants', icon: <Building2 className="size-4" /> },
    { id: 'new', label: 'New tenant', icon: <Plus className="size-4" /> },
    { id: 'audit', label: 'Platform audit', icon: <ScrollText className="size-4" /> },
  ];
  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/75 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 md:px-8">
          <span className="flex items-center gap-2 font-semibold text-fg">
            <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-brand to-brand-2 text-white">
              <ServerCog className="size-4" />
            </span>
            Platform
          </span>
          <nav className="ms-4 flex gap-1" aria-label="Main">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id}
                className={cn('focus-ring relative flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors', tab === t.id ? 'text-brand-text' : 'text-muted hover:text-fg')}
              >
                {tab === t.id && <motion.span layoutId="platform-tab" transition={spring} className="absolute inset-0 rounded-lg bg-brand-soft" />}
                <span className="relative">{t.icon}</span>
                <span className="relative hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </nav>
          <div className="flex-1" />
          <button onClick={toggle} className="focus-ring grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label="Toggle dark mode">
            {resolved === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <Button variant="ghost" size="sm" icon={<LogOut className="size-4" />} onClick={() => void platformApi.logout().finally(onLogout)}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 md:px-8">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
            {tab === 'tenants' && <Tenants onNew={() => setTab('new')} />}
            {tab === 'new' && <NewTenant onCreated={() => setTab('tenants')} />}
            {tab === 'audit' && <PlatformAudit />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function Tenants({ onNew }: { onNew: () => void }) {
  const { formatDate } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.platform.tenants, queryFn: () => platformApi.get<TenantSummary[]>('/api/platform/tenants') });
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.platform.tenants });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'suspend' | 'activate' }) => platformApi.post(`/api/platform/tenants/${id}/${action}`),
    onSuccess: (_d, v) => {
      toast.success(v.action === 'suspend' ? 'Tenant suspended: every request is now refused' : 'Tenant reactivated');
      refresh();
    },
  });
  const plan = useMutation({
    mutationFn: ({ id, plan }: { id: string; plan: string }) => platformApi.put(`/api/platform/tenants/${id}/plan`, { plan }),
    onSuccess: () => {
      toast.success('Plan changed');
      refresh();
    },
  });
  const health = useQuery({
    queryKey: qk.platform.health,
    queryFn: () => platformApi.get<HealthReport>('/api/platform/tenant-health'),
    refetchInterval: 5_000,
  });
  const healthOf = (slug: string) => health.data?.tenants.find((h) => h.tenant === slug);
  const active = q.data?.filter((t) => t.status === 'ACTIVE').length ?? 0;
  return (
    <Page>
      <PageHeader
        eyebrow="Tenancy"
        title="Tenants"
        subtitle={q.data ? `${q.data.length} organisations · ${active} active` : undefined}
        actions={
          <Button icon={<Plus className="size-4" />} onClick={onNew}>
            New tenant
          </Button>
        }
      />
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={!q.data?.length} onRetry={() => void q.refetch()} skeleton={<SkeletonCards count={3} />}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data?.map((t) => (
            <motion.div key={t.id} variants={fadeUp} layout whileHover={{ y: -3 }} className={cn('rounded-2xl border border-line bg-surface p-5 shadow-card', t.status === 'SUSPENDED' && 'opacity-75')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-fg">{t.name}</div>
                  <a className="mt-0.5 inline-flex items-center gap-1 text-xs text-brand-text hover:underline" href={tenantUrl(t.slug)} target="_blank" rel="noreferrer">
                    {t.slug}.localhost <ExternalLink className="size-3" />
                  </a>
                </div>
                <StatusBadge status={t.status} />
              </div>
              <div className="mt-4 flex items-center gap-2">
                <Select aria-label={`Plan of ${t.name}`} value={t.plan} onChange={(e) => plan.mutate({ id: t.id, plan: e.target.value })} className="h-8 w-36 text-xs">
                  {PLAN_CODES.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
                <span className="text-xs text-muted">since {formatDate(t.createdAt)}</span>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
                <HealthStrip h={healthOf(t.slug)} />
                {t.status === 'ACTIVE' ? (
                  <Button size="sm" variant="danger" busy={act.isPending && act.variables?.id === t.id} onClick={() => act.mutate({ id: t.id, action: 'suspend' })}>
                    Suspend
                  </Button>
                ) : t.status === 'SUSPENDED' ? (
                  <Button size="sm" variant="secondary" busy={act.isPending && act.variables?.id === t.id} onClick={() => act.mutate({ id: t.id, action: 'activate' })}>
                    Reactivate
                  </Button>
                ) : null}
              </div>
            </motion.div>
          ))}
        </div>
      </QueryState>
      {(act.error ?? plan.error) && <ErrorBox error={act.error ?? plan.error} />}
    </Page>
  );
}

interface TenantHealth {
  tenant: string;
  requests: number;
  requestsPerMinute: number;
  errorRate: number;
  throttled: number;
  p95Ms: number | null;
}
interface HealthReport {
  windowMinutes: number;
  tenants: TenantHealth[];
}

/**
 * Last five minutes of a tenant's traffic on this instance (noisy-neighbour watch, experiment E4):
 * red when it errors or is being throttled, amber when p95 exceeds the 250 ms target.
 */
function HealthStrip({ h }: { h: TenantHealth | undefined }) {
  if (!h || h.requests === 0) return <span className="text-xs text-muted">No traffic in the last 5 min</span>;
  const tone = h.errorRate > 0.01 || h.throttled > 0 ? 'bg-red-500' : (h.p95Ms ?? 0) > 250 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted" title="Last 5 minutes on this instance">
      <span className="relative flex size-2 shrink-0">
        <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', tone)} />
        <span className={cn('relative inline-flex size-2 rounded-full', tone)} />
      </span>
      <Activity className="size-3.5 shrink-0" />
      <span className="truncate tabular">
        {h.requestsPerMinute}/min · p95 {h.p95Ms ?? '—'} ms
        {h.errorRate > 0 && ` · ${(h.errorRate * 100).toFixed(1)}% 5xx`}
        {h.throttled > 0 && ` · ${h.throttled} throttled`}
      </span>
    </div>
  );
}

/** Demo 1: a new customer is one form and one API call; the result shows the measured time. */
function NewTenant({ onCreated }: { onCreated: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    slug: '',
    plan: 'BUSINESS',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
    appName: '',
    primaryColor: '#0f766e',
    secondaryColor: '#1d4ed8',
    locale: 'en' as 'en' | 'fa',
    approvalRequired: false,
    selfAssessmentRequired: true,
  });
  const [result, setResult] = useState<{ slug: string; durationMs: number; roundTripMs: number } | null>(null);
  const create = useMutation({
    mutationFn: async () => {
      const body: CreateTenantInput = {
        name: form.name,
        slug: form.slug,
        plan: form.plan,
        admin: { email: form.adminEmail, fullName: form.adminName, password: form.adminPassword },
        // Validated (incl. WCAG contrast) by the server; field errors come back as branding.*.
        branding: { appName: form.appName || form.name, logoUrl: null, primaryColor: form.primaryColor, secondaryColor: form.secondaryColor, locale: form.locale },
        evaluationPolicy: { approvalRequired: form.approvalRequired, selfAssessmentRequired: form.selfAssessmentRequired },
      };
      const started = performance.now();
      const res = await platformApi.post<{ tenant: TenantSummary; durationMs: number }>('/api/platform/tenants', body);
      return { slug: res.tenant.slug, durationMs: res.durationMs, roundTripMs: Math.round(performance.now() - started) };
    },
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: qk.platform.tenants });
    },
  });
  const errors = create.error instanceof ApiError ? create.error.fieldErrors : {};
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setResult(null);
    create.mutate();
  };
  const appName = form.appName || form.name || 'Your organisation';

  return (
    <Page>
      <PageHeader eyebrow="Onboarding" title="New tenant" subtitle="No code change, no deployment, no restart (NF-11)." />
      <form onSubmit={submit} className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card title="Organisation" icon={<Building2 className="size-4" />}>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Name" error={errors.name}>{(id, inv) => <Input id={id} aria-invalid={inv} required value={form.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
              <Field label="Sub-domain" error={errors.slug} hint={form.slug ? `${form.slug}.localhost` : 'lowercase, digits, hyphens'}>
                {(id, inv) => <Input id={id} aria-invalid={inv} required pattern="[a-z0-9-]{3,40}" value={form.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase() })} />}
              </Field>
              <Field label="Plan" hint={PLANS[form.plan as keyof typeof PLANS].features.join(', ') || 'no optional features'}>
                {(id) => (
                  <Select id={id} value={form.plan} onChange={(e) => set({ plan: e.target.value })}>
                    {PLAN_CODES.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </Card>
          <Card title="First administrator">
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Full name" error={errors['admin.fullName']}>{(id, inv) => <Input id={id} aria-invalid={inv} required value={form.adminName} onChange={(e) => set({ adminName: e.target.value })} />}</Field>
              <Field label="E-mail" error={errors['admin.email']}>{(id, inv) => <Input id={id} aria-invalid={inv} type="email" required value={form.adminEmail} onChange={(e) => set({ adminEmail: e.target.value })} />}</Field>
              <Field label="Initial password" error={errors['admin.password']}>
                {(id, inv) => <Input id={id} aria-invalid={inv} type="password" required minLength={10} autoComplete="new-password" value={form.adminPassword} onChange={(e) => set({ adminPassword: e.target.value })} />}
              </Field>
            </div>
          </Card>
          <Card title="Branding and policy">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="App name">{(id) => <Input id={id} placeholder={form.name} value={form.appName} onChange={(e) => set({ appName: e.target.value })} />}</Field>
              <Field label="Language">
                {() => (
                  <Segmented
                    id="nt-locale"
                    value={form.locale}
                    onChange={(locale) => set({ locale })}
                    options={[
                      { value: 'en', label: 'English' },
                      { value: 'fa', label: 'فارسی' },
                    ]}
                  />
                )}
              </Field>
              <Field label="Primary colour" error={errors['branding.primaryColor']}>
                {(id) => <input id={id} type="color" className="h-9 w-full cursor-pointer rounded-lg border border-line bg-surface" value={form.primaryColor} onChange={(e) => set({ primaryColor: e.target.value })} />}
              </Field>
              <Field label="Secondary colour" error={errors['branding.secondaryColor']}>
                {(id) => <input id={id} type="color" className="h-9 w-full cursor-pointer rounded-lg border border-line bg-surface" value={form.secondaryColor} onChange={(e) => set({ secondaryColor: e.target.value })} />}
              </Field>
            </div>
            <div className="mt-5 flex flex-wrap gap-6">
              <Toggle checked={form.selfAssessmentRequired} onChange={(v) => set({ selfAssessmentRequired: v })} label="Self-assessment" />
              <Toggle checked={form.approvalRequired} onChange={(v) => set({ approvalRequired: v })} label="Approval before publishing" />
            </div>
          </Card>
        </div>

        <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <motion.div variants={fadeUp} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            <div className="px-5 pt-4 pb-3 text-xs font-medium text-muted">Preview of the new tenant’s login</div>
            <div className="relative h-44 overflow-hidden" style={{ background: `linear-gradient(135deg, ${form.primaryColor}, ${form.secondaryColor})` }}>
              <div className="absolute inset-x-6 top-8 rounded-xl bg-white/95 p-4 shadow-lg" dir={form.locale === 'fa' ? 'rtl' : 'ltr'}>
                <div className="flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-lg text-xs font-bold text-white" style={{ background: form.primaryColor }}>
                    {appName.slice(0, 1)}
                  </span>
                  <span className="truncate text-sm font-semibold text-zinc-900">{appName}</span>
                </div>
                <div className="mt-3 h-2 rounded bg-zinc-200" />
                <div className="mt-2 h-6 rounded-md" style={{ background: form.primaryColor }} />
              </div>
            </div>
            <div className="p-5">
              <Button type="submit" size="lg" busy={create.isPending} className="w-full" icon={<Rocket className="size-4" />}>
                Create tenant
              </Button>
            </div>
          </motion.div>
          <AnimatePresence>
            {result && (
              <motion.div initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={spring} className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.07] p-5">
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                  <Timer className="size-4" /> Provisioned in
                </div>
                <div className="mt-1 text-4xl font-semibold tracking-tight text-fg tabular">
                  <CountUp value={result.durationMs} /> <span className="text-base font-normal text-muted">ms</span>
                </div>
                <p className="mt-1 text-xs text-muted">round trip {result.roundTripMs} ms · one transaction, no restart</p>
                <div className="mt-4 flex gap-2">
                  <a href={tenantUrl(result.slug)} target="_blank" rel="noreferrer" className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-medium text-white">
                    Open {result.slug}.localhost <ExternalLink className="size-3.5" />
                  </a>
                  <Button type="button" size="sm" variant="ghost" onClick={onCreated}>
                    Back to tenants
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {create.error && !Object.keys(errors).length && <ErrorBox error={create.error} />}
        </div>
      </form>
    </Page>
  );
}

interface PlatformAuditEntry {
  id: string;
  category: string;
  action: string;
  actor: { fullName: string } | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

function PlatformAudit() {
  const { formatDateTime } = useI18n();
  const q = useQuery({ queryKey: qk.platform.audit, queryFn: () => platformApi.get<PageOf<PlatformAuditEntry>>('/api/platform/audit?limit=100') });
  return (
    <Page>
      <PageHeader eyebrow="Accountability" title="Platform audit" subtitle="Operations of platform admins (PL-05). Append-only." />
      <Card>
        <QueryState isLoading={q.isLoading} error={q.error} isEmpty={!q.data?.items.length}>
          <Table head={['When', 'Action', 'Actor', 'Details']}>
            {q.data?.items.map((r) => (
              <Tr key={r.id}>
                <Td className="text-xs text-muted tabular">{formatDateTime(r.createdAt)}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <Badge tone={r.category}>{r.category}</Badge>
                    <code className="text-xs text-fg">{r.action}</code>
                  </div>
                </Td>
                <Td>{r.actor?.fullName ?? '—'}</Td>
                <Td>
                  <code className="rounded-md bg-surface-2 px-2 py-1 text-[11px] text-muted">{JSON.stringify(r.metadata)}</code>
                </Td>
              </Tr>
            ))}
          </Table>
        </QueryState>
      </Card>
    </Page>
  );
}
