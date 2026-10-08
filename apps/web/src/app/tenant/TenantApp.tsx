import { lazy, Suspense, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { Toaster } from 'sonner';
import type { FeatureKey, Permission } from '@appraisal/contracts';
import { AppShell, BrandMark } from '../../features/shell/AppShell';
import { AuthLayout, HeroPoints, LoginForm } from '../../features/auth/LoginPage';
import { I18nProvider, useI18n } from '../../shared/i18n/i18n';
import { useColorMode } from '../../shared/lib/color-mode';
import { SkeletonCards, SkeletonRows } from '../../shared/ui';
import { TenantSessionProvider, useMe, useSession } from './session';

const Dashboard = lazy(() => import('../../features/dashboard/DashboardPage'));
const EvaluationList = lazy(() => import('../../features/evaluations/EvaluationListPage'));
const EvaluationDetail = lazy(() => import('../../features/evaluations/EvaluationDetailPage'));
const TeamPage = lazy(() => import('../../features/team/TeamPage'));
const CyclesPage = lazy(() => import('../../features/cycles/CyclesPage'));
const PeoplePage = lazy(() => import('../../features/people/PeoplePage'));
const OrganisationPage = lazy(() => import('../../features/organisation/OrganisationPage'));
const RolesPage = lazy(() => import('../../features/roles/RolesPage'));
const SettingsPage = lazy(() => import('../../features/settings/SettingsPage'));
const AuditPage = lazy(() => import('../../features/audit/AuditPage'));
const ReportsPage = lazy(() => import('../../features/reports/ReportsPage'));
const AnalyticsPage = lazy(() => import('../../features/reports/AnalyticsPage'));

export default function TenantApp() {
  return (
    <TenantSessionProvider>
      <Gate />
    </TenantSessionProvider>
  );
}

function Splash() {
  return (
    <div className="grid min-h-screen place-items-center bg-bg">
      <motion.div
        className="size-10 rounded-2xl bg-gradient-to-br from-brand to-brand-2"
        animate={{ scale: [1, 1.12, 1], rotate: [0, 8, 0] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

function Gate() {
  const { state, login } = useSession();
  switch (state.phase) {
    case 'booting':
      return <Splash />;
    case 'unknown-tenant':
      return (
        <I18nProvider locale="en">
          <UnknownTenant />
        </I18nProvider>
      );
    case 'anonymous':
      return (
        <I18nProvider locale={state.branding.locale}>
          <TenantLogin branding={state.branding} onSubmit={login} />
        </I18nProvider>
      );
    case 'ready':
      return (
        <I18nProvider locale={state.me.branding.locale}>
          <BrowserRouter>
            <Shell />
          </BrowserRouter>
          <ThemedToaster />
        </I18nProvider>
      );
  }
}

function ThemedToaster() {
  const { resolved } = useColorMode();
  const { locale } = useI18n();
  return <Toaster theme={resolved} position={locale === 'fa' ? 'bottom-left' : 'bottom-right'} dir={locale === 'fa' ? 'rtl' : 'ltr'} richColors closeButton />;
}

function UnknownTenant() {
  const { t } = useI18n();
  return (
    <div className="grid min-h-screen place-items-center bg-bg p-6">
      <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-md text-center text-muted">
        {t('auth.unknownTenant')}
      </motion.p>
    </div>
  );
}

function TenantLogin({ branding, onSubmit }: { branding: Parameters<typeof BrandMark>[0]['branding'] & { tenantName: string }; onSubmit: (e: string, p: string) => Promise<void> }) {
  const { t } = useI18n();
  return (
    <AuthLayout
      hero={
        <HeroPoints
          heading={
            <div className="flex items-center gap-3">
              <BrandMark branding={branding} />
              <span className="text-lg font-semibold">{branding.appName}</span>
            </div>
          }
          tagline={t('auth.tagline')}
          points={[t('auth.points.1'), t('auth.points.2'), t('auth.points.3')]}
          footnote={t('auth.secure')}
        />
      }
    >
      <LoginForm
        title={t('auth.welcome', { app: branding.appName })}
        subtitle={t('auth.orgOf', { name: branding.tenantName })}
        logo={<BrandMark branding={branding} size="lg" />}
        onSubmit={onSubmit}
      />
    </AuthLayout>
  );
}

function Shell() {
  const { me, can, has, logout } = useMe();
  const location = useLocation();
  const guard = (perm: Permission | null, el: ReactNode, feature?: FeatureKey) =>
    (perm && !can(perm)) || (feature && !has(feature)) ? <Navigate to="/" replace /> : el;
  const fallback = (
    <div className="space-y-6">
      <SkeletonCards />
      <div className="rounded-2xl border border-line bg-surface p-5">
        <SkeletonRows />
      </div>
    </div>
  );

  return (
    <AppShell me={me} onLogout={() => void logout()}>
      <Suspense fallback={fallback}>
        <Routes location={location}>
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
    </AppShell>
  );
}
