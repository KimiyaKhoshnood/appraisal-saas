import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PLAN_CODES,
  PLANS,
  type CreateTenantInput,
  type Page,
  type TenantSummary,
} from '@appraisal/contracts';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, QueryState, Select, Spinner, StatusBadge, Table, Td, Toggle } from '../components/ui';
import { I18nProvider, useI18n } from '../i18n/i18n';
import { ApiError, platformApi } from '../lib/api';
import { tenantUrl } from '../lib/host';
import { applyBranding } from '../lib/theme';

export default function PlatformApp() {
  const [phase, setPhase] = useState<'booting' | 'anonymous' | 'ready'>('booting');
  useEffect(() => {
    applyBranding({ appName: 'Platform console', primaryColor: '#334155', secondaryColor: '#0f766e', locale: 'en' });
    platformApi.onSessionLost = () => setPhase('anonymous');
    void platformApi.refresh().then((ok) => setPhase(ok ? 'ready' : 'anonymous'));
  }, []);
  return (
    <I18nProvider locale="en">
      {phase === 'booting' ? (
        <div className="grid min-h-screen place-items-center">
          <Spinner />
        </div>
      ) : phase === 'anonymous' ? (
        <PlatformLogin onDone={() => setPhase('ready')} />
      ) : (
        <Console onLogout={() => setPhase('anonymous')} />
      )}
    </I18nProvider>
  );
}

function PlatformLogin({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await platformApi.login(email, password);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? 'Too many attempts' : 'Invalid e-mail or password');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid min-h-screen place-items-center bg-slate-800 p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-8 shadow-xl">
        <div>
          <h1 className="text-xl font-semibold">Platform console</h1>
          <p className="text-sm text-slate-500">Operators only. Separate identity from every tenant.</p>
        </div>
        <Field label="E-mail">{(id) => <Input id={id} type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Password">{(id) => <Input id={id} type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <Button type="submit" busy={busy} className="w-full">
          Sign in
        </Button>
      </form>
    </div>
  );
}

function Console({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<'tenants' | 'new' | 'audit'>('tenants');
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between bg-slate-800 px-6 py-3 text-white">
        <span className="font-semibold">Platform console</span>
        <nav className="flex gap-1" aria-label="Main">
          {(
            [
              ['tenants', 'Tenants'],
              ['new', 'New tenant'],
              ['audit', 'Platform audit'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} aria-current={tab === k} className={`rounded-md px-3 py-1.5 text-sm ${tab === k ? 'bg-white/15' : 'hover:bg-white/10'}`}>
              {label}
            </button>
          ))}
          <button
            className="ms-4 rounded-md px-3 py-1.5 text-sm hover:bg-white/10"
            onClick={() => void platformApi.logout().finally(onLogout)}
          >
            Sign out
          </button>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl p-6 md:p-8">
        {tab === 'tenants' && <Tenants />}
        {tab === 'new' && <NewTenant onCreated={() => setTab('tenants')} />}
        {tab === 'audit' && <PlatformAudit />}
      </main>
    </div>
  );
}

function Tenants() {
  const { formatDate } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tenants'], queryFn: () => platformApi.get<TenantSummary[]>('/api/platform/tenants') });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'suspend' | 'activate' }) => platformApi.post(`/api/platform/tenants/${id}/${action}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenants'] }),
  });
  const plan = useMutation({
    mutationFn: ({ id, plan }: { id: string; plan: string }) => platformApi.put(`/api/platform/tenants/${id}/plan`, { plan }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenants'] }),
  });
  return (
    <>
      <PageHeader title="Tenants" subtitle="Every organisation is a row, not a deployment." />
      <Card>
        <QueryState isLoading={q.isLoading} error={q.error} isEmpty={!q.data?.length} onRetry={() => void q.refetch()}>
          <Table head={['Name', 'Sub-domain', 'Plan', 'Status', 'Created', '']}>
            {q.data?.map((t) => (
              <tr key={t.id}>
                <Td className="font-medium">{t.name}</Td>
                <Td>
                  <a className="text-brand hover:underline" href={tenantUrl(t.slug)} target="_blank" rel="noreferrer">
                    {t.slug}
                  </a>
                </Td>
                <Td>
                  <Select aria-label={`Plan of ${t.name}`} value={t.plan} onChange={(e) => plan.mutate({ id: t.id, plan: e.target.value })} className="w-36">
                    {PLAN_CODES.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </Select>
                </Td>
                <Td>
                  <StatusBadge status={t.status} />
                </Td>
                <Td className="text-slate-500">{formatDate(t.createdAt)}</Td>
                <Td className="text-end">
                  {t.status === 'ACTIVE' ? (
                    <Button variant="danger" onClick={() => act.mutate({ id: t.id, action: 'suspend' })}>
                      Suspend
                    </Button>
                  ) : t.status === 'SUSPENDED' ? (
                    <Button variant="secondary" onClick={() => act.mutate({ id: t.id, action: 'activate' })}>
                      Reactivate
                    </Button>
                  ) : null}
                </Td>
              </tr>
            ))}
          </Table>
        </QueryState>
        {(act.error ?? plan.error) && <ErrorBox error={act.error ?? plan.error} />}
      </Card>
    </>
  );
}

/** Demo 1: a new customer is one form and one API call; the timer shows it on screen. */
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
        branding: {
          appName: form.appName || form.name,
          logoUrl: null,
          primaryColor: form.primaryColor,
          secondaryColor: form.secondaryColor,
          locale: form.locale,
        },
        evaluationPolicy: { approvalRequired: form.approvalRequired, selfAssessmentRequired: form.selfAssessmentRequired },
      };
      const started = performance.now();
      const res = await platformApi.post<{ tenant: TenantSummary; durationMs: number }>('/api/platform/tenants', body);
      return { slug: res.tenant.slug, durationMs: res.durationMs, roundTripMs: Math.round(performance.now() - started) };
    },
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: ['tenants'] });
    },
  });
  const errors = create.error instanceof ApiError ? create.error.fieldErrors : {};
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setResult(null);
    create.mutate();
  };

  return (
    <>
      <PageHeader title="New tenant" subtitle="No code change, no deployment, no restart (NF-11)." />
      <form onSubmit={submit} className="space-y-6">
        <Card title="Organisation">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Name" error={errors.name}>{(id) => <Input id={id} required value={form.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
            <Field label="Sub-domain" error={errors.slug} hint={form.slug ? `${form.slug}.localhost` : 'lowercase, digits, hyphens'}>
              {(id) => <Input id={id} required pattern="[a-z0-9-]{3,40}" value={form.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase() })} />}
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
            <Field label="Full name" error={errors['admin.fullName']}>{(id) => <Input id={id} required value={form.adminName} onChange={(e) => set({ adminName: e.target.value })} />}</Field>
            <Field label="E-mail" error={errors['admin.email']}>{(id) => <Input id={id} type="email" required value={form.adminEmail} onChange={(e) => set({ adminEmail: e.target.value })} />}</Field>
            <Field label="Initial password" error={errors['admin.password']}>
              {(id) => <Input id={id} type="password" required minLength={10} autoComplete="new-password" value={form.adminPassword} onChange={(e) => set({ adminPassword: e.target.value })} />}
            </Field>
          </div>
        </Card>
        <Card title="Branding and policy">
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="App name">{(id) => <Input id={id} placeholder={form.name} value={form.appName} onChange={(e) => set({ appName: e.target.value })} />}</Field>
            <Field label="Primary colour" error={errors['branding.primaryColor']}>
              {(id) => <input id={id} type="color" className="h-10 w-full rounded border border-slate-300" value={form.primaryColor} onChange={(e) => set({ primaryColor: e.target.value })} />}
            </Field>
            <Field label="Secondary colour" error={errors['branding.secondaryColor']}>
              {(id) => <input id={id} type="color" className="h-10 w-full rounded border border-slate-300" value={form.secondaryColor} onChange={(e) => set({ secondaryColor: e.target.value })} />}
            </Field>
            <Field label="Language">
              {(id) => (
                <Select id={id} value={form.locale} onChange={(e) => set({ locale: e.target.value as 'en' | 'fa' })}>
                  <option value="en">English</option>
                  <option value="fa">فارسی</option>
                </Select>
              )}
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap gap-6">
            <Toggle checked={form.selfAssessmentRequired} onChange={(v) => set({ selfAssessmentRequired: v })} label="Self-assessment" />
            <Toggle checked={form.approvalRequired} onChange={(v) => set({ approvalRequired: v })} label="Approval before publishing" />
          </div>
        </Card>
        <div className="flex items-center gap-4">
          <Button type="submit" busy={create.isPending}>
            Create tenant
          </Button>
          {result && (
            <span className="text-sm text-emerald-800">
              <Badge tone="PUBLISHED">Ready</Badge> provisioned in <strong>{result.durationMs} ms</strong> (round trip {result.roundTripMs} ms) —{' '}
              <a className="font-medium underline" href={tenantUrl(result.slug)} target="_blank" rel="noreferrer">
                open {result.slug}.localhost
              </a>{' '}
              <button type="button" className="ms-2 underline" onClick={onCreated}>
                back to the list
              </button>
            </span>
          )}
        </div>
        {create.error && !Object.keys(errors).length && <ErrorBox error={create.error} />}
      </form>
    </>
  );
}

interface PlatformAuditEntry {
  id: string;
  category: string;
  action: string;
  actor: { fullName: string } | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

function PlatformAudit() {
  const { formatDateTime } = useI18n();
  const q = useQuery({ queryKey: ['platform-audit'], queryFn: () => platformApi.get<Page<PlatformAuditEntry>>('/api/platform/audit?limit=100') });
  return (
    <>
      <PageHeader title="Platform audit" subtitle="Operations of platform admins (PL-05). Append-only." />
      <Card>
        <QueryState isLoading={q.isLoading} error={q.error} isEmpty={!q.data?.items.length}>
          <Table head={['When', '', 'Action', 'Actor', 'Details']}>
            {q.data?.items.map((r) => (
              <tr key={r.id}>
                <Td className="text-slate-500">{formatDateTime(r.createdAt)}</Td>
                <Td>
                  <Badge tone={r.category}>{r.category}</Badge>
                </Td>
                <Td>
                  <code className="text-xs">{r.action}</code>
                </Td>
                <Td>{r.actor?.fullName ?? '—'}</Td>
                <Td>
                  <code className="text-xs text-slate-600">{JSON.stringify(r.metadata)}</code>
                </Td>
              </tr>
            ))}
          </Table>
        </QueryState>
      </Card>
    </>
  );
}
