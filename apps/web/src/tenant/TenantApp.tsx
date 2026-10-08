import { lazy, Suspense, useState, type FormEvent, type ReactNode } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router';
import type { FeatureKey, Permission, PublicBranding } from '@appraisal/contracts';
import { Button, Field, Input, Spinner, cx } from '../components/ui';
import { I18nProvider, useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { ApiError } from '../lib/api';
import { TenantSessionProvider, useMe, useSession } from './session';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const EvaluationList = lazy(() => import('./pages/EvaluationList'));
const EvaluationDetail = lazy(() => import('./pages/EvaluationDetail'));
const TeamPage = lazy(() => import('./pages/Team'));
const CyclesPage = lazy(() => import('./pages/Cycles'));
const PeoplePage = lazy(() => import('./pages/People'));
const OrganisationPage = lazy(() => import('./pages/Organisation'));
const RolesPage = lazy(() => import('./pages/Roles'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const AuditPage = lazy(() => import('./pages/Audit'));
const ReportsPage = lazy(() => import('./pages/Reports'));
const AnalyticsPage = lazy(() => import('./pages/Analytics'));

export default function TenantApp() {
  return (
    <TenantSessionProvider>
      <Gate />
    </TenantSessionProvider>
  );
}

function Gate() {
  const { state } = useSession();
  switch (state.phase) {
    case 'booting':
      return (
        <div className="grid min-h-screen place-items-center text-slate-400">
          <Spinner />
        </div>
      );
    case 'unknown-tenant':
      return (
        <I18nProvider locale="en">
          <UnknownTenant />
        </I18nProvider>
      );
    case 'anonymous':
      return (
        <I18nProvider locale={state.branding.locale}>
          <LoginPage branding={state.branding} />
        </I18nProvider>
      );
    case 'ready':
      return (
        <I18nProvider locale={state.me.branding.locale}>
          <BrowserRouter>
            <Shell />
          </BrowserRouter>
        </I18nProvider>
      );
  }
}

function UnknownTenant() {
  const { t } = useI18n();
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <p className="max-w-md text-center text-slate-600">{t('auth.unknownTenant')}</p>
    </div>
  );
}

function Logo({ branding, size = 'md' }: { branding: Pick<PublicBranding, 'appName' | 'logoUrl'>; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-12 text-xl' : 'size-9 text-base';
  return branding.logoUrl ? (
    <img src={branding.logoUrl} alt="" className={cx(box, 'rounded-lg object-contain')} referrerPolicy="no-referrer" />
  ) : (
    <div className={cx(box, 'grid place-items-center rounded-lg bg-brand font-bold text-white')}>{branding.appName.slice(0, 1)}</div>
  );
}

function LoginPage({ branding }: { branding: PublicBranding }) {
  const { login } = useSession();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? t('auth.throttled') : t('auth.invalid'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-brand-soft to-slate-100 p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-8 shadow-xl ring-1 ring-slate-200">
        <div className="flex items-center gap-3">
          <Logo branding={branding} size="lg" />
          <div>
            <h1 className="text-xl font-semibold">{t('auth.welcome', { app: branding.appName })}</h1>
            <p className="text-sm text-slate-500">{t('auth.orgOf', { name: branding.tenantName })}</p>
          </div>
        </div>
        <Field label={t('app.email')}>
          {(id) => <Input id={id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label={t('auth.password')}>
          {(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}
        <Button type="submit" busy={busy} className="w-full">
          {t('auth.signIn')}
        </Button>
      </form>
    </div>
  );
}

interface NavItem {
  to: string;
  label: MessageKey;
  permission?: Permission;
  feature?: FeatureKey;
  managerOnly?: boolean;
}

/** FE-02: the menu is computed from permissions + features in /me/context. */
const NAV: NavItem[] = [
  { to: '/', label: 'nav.dashboard' },
  { to: '/evaluations', label: 'nav.myEvaluations', permission: 'evaluation:self' },
  { to: '/team', label: 'nav.team', permission: 'evaluation:manage', managerOnly: true },
  { to: '/approvals', label: 'nav.approvals', permission: 'evaluation:approve' },
  { to: '/all-evaluations', label: 'nav.allEvaluations', permission: 'evaluation:read-all' },
  { to: '/cycles', label: 'nav.cycles', permission: 'cycle:write' },
  { to: '/people', label: 'nav.people', permission: 'user:read' },
  { to: '/organisation', label: 'nav.organisation', permission: 'org:read' },
  { to: '/roles', label: 'nav.roles', permission: 'role:read' },
  { to: '/reports', label: 'nav.reports', permission: 'report:read', feature: 'reports' },
  { to: '/analytics', label: 'nav.analytics', permission: 'analytics:read', feature: 'analytics' },
  { to: '/settings', label: 'nav.settings', permission: 'config:read' },
  { to: '/audit', label: 'nav.audit', permission: 'audit:read' },
];

function Shell() {
  const { me, can, has, logout } = useMe();
  const { t } = useI18n();
  const items = NAV.filter(
    (n) => (!n.permission || can(n.permission)) && (!n.feature || has(n.feature)) && (!n.managerOnly || me.isManager),
  );
  const guard = (perm: Permission | null, el: ReactNode, feature?: FeatureKey) =>
    (perm && !can(perm)) || (feature && !has(feature)) ? <Navigate to="/" replace /> : el;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-e border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <Logo branding={me.branding} />
          <div className="min-w-0">
            <div className="truncate font-semibold">{me.branding.appName}</div>
            <div className="truncate text-xs text-slate-500">{me.tenant.name}</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3" aria-label="Main">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/' || n.to === '/evaluations'}
              className={({ isActive }) =>
                cx('focus-ring block rounded-lg px-3 py-2 text-sm', isActive ? 'bg-brand-soft font-medium text-brand' : 'text-slate-700 hover:bg-slate-50')
              }
            >
              {t(n.label)}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-4 text-sm">
          <div className="truncate font-medium">{me.user.fullName}</div>
          <div className="truncate text-xs text-slate-500">{me.user.email}</div>
          <Button variant="ghost" className="mt-2 -ms-3" onClick={() => void logout()}>
            {t('auth.signOut')}
          </Button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
          <span className="font-semibold">{me.branding.appName}</span>
          <Button variant="ghost" onClick={() => void logout()}>
            {t('auth.signOut')}
          </Button>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-2 md:hidden" aria-label="Main">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/' || n.to === '/evaluations'} className={({ isActive }) => cx('rounded-md px-3 py-1.5 text-sm whitespace-nowrap', isActive ? 'bg-brand-soft text-brand' : 'text-slate-600')}>
              {t(n.label)}
            </NavLink>
          ))}
        </nav>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">
          <Suspense fallback={<Spinner />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/evaluations" element={<EvaluationList scope="mine" />} />
              <Route path="/approvals" element={guard('evaluation:approve', <EvaluationList scope="approvals" />)} />
              <Route path="/all-evaluations" element={guard('evaluation:read-all', <EvaluationList scope="all" />)} />
              <Route path="/evaluations/:id" element={<EvaluationDetail />} />
              <Route path="/team" element={guard('evaluation:manage', <TeamPage />)} />
              <Route path="/cycles" element={guard('cycle:write', <CyclesPage />)} />
              <Route path="/people" element={guard('user:read', <PeoplePage />)} />
              <Route path="/organisation" element={guard('org:read', <OrganisationPage />)} />
              <Route path="/roles" element={guard('role:read', <RolesPage />)} />
              <Route path="/settings" element={guard('config:read', <SettingsPage />)} />
              <Route path="/audit" element={guard('audit:read', <AuditPage />)} />
              <Route path="/reports" element={guard('report:read', <ReportsPage />, 'reports')} />
              <Route path="/analytics" element={guard('analytics:read', <AnalyticsPage />, 'analytics')} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
