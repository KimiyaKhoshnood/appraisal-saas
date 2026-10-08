import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Link } from 'react-router';
import { ArrowRight, CheckCheck, ClipboardCheck, Gauge, Sparkles, UsersRound } from 'lucide-react';
import type { EvaluationStatus } from '@appraisal/contracts';
import { useMe } from '../../app/tenant/session';
import { useI18n } from '../../shared/i18n/i18n';
import { tenantApi } from '../../shared/lib/api';
import { qk } from '../../shared/lib/query-keys';
import { Card, EmptyState, Page, QueryState, SkeletonRows, Stat, StatusBadge, fadeUp } from '../../shared/ui';
import { Aurora } from '../auth/LoginPage';
import { useEvaluations } from '../evaluations/api';

export interface TeamDashboard {
  cycle: { id: string; name: string; status: string } | null;
  byStatus: Record<EvaluationStatus, number>;
  published: number;
  averageFinalScore: number | null;
  directReports: number;
  team: { evaluationId: string; employee: { id: string; fullName: string }; status: EvaluationStatus; finalScore: number | null; updatedAt: string }[];
}

export const STATUS_ORDER: EvaluationStatus[] = ['DRAFT', 'SELF_SUBMITTED', 'MANAGER_SUBMITTED', 'PENDING_APPROVAL', 'PUBLISHED'];
const STATUS_FILL: Record<EvaluationStatus, string> = {
  DRAFT: 'bg-zinc-300 dark:bg-zinc-600',
  SELF_SUBMITTED: 'bg-sky-500',
  MANAGER_SUBMITTED: 'bg-amber-500',
  PENDING_APPROVAL: 'bg-orange-500',
  PUBLISHED: 'bg-emerald-500',
};

/** Stacked progress bar of a team's statuses; segments grow in, with a 2px gap between fills. */
export function StatusProgress({ byStatus }: { byStatus: Record<EvaluationStatus, number> }) {
  const { t, formatNumber } = useI18n();
  const total = STATUS_ORDER.reduce((s, k) => s + byStatus[k], 0) || 1;
  return (
    <div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full bg-surface-2">
        {STATUS_ORDER.filter((k) => byStatus[k] > 0).map((k, i) => (
          <motion.div
            key={k}
            className={`h-full first:rounded-s-full last:rounded-e-full ${STATUS_FILL[k]}`}
            initial={{ width: 0 }}
            animate={{ width: `${(byStatus[k] / total) * 100}%` }}
            transition={{ duration: 0.7, delay: 0.1 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
            title={`${t(`status.${k}`)}: ${byStatus[k]}`}
          />
        ))}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-5">
        {STATUS_ORDER.map((k) => (
          <li key={k} className="flex items-center gap-2">
            <span className={`size-2 rounded-full ${STATUS_FILL[k]}`} />
            <span className="truncate text-muted">{t(`status.${k}`)}</span>
            <span className="ms-auto font-medium text-fg tabular">{formatNumber(byStatus[k])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DashboardPage() {
  const { me, can } = useMe();
  const { t, formatNumber } = useI18n();
  const mine = useEvaluations('mine', 5, can('evaluation:self'));
  const approvals = useEvaluations('approvals', 50, can('evaluation:approve'));
  const team = useQuery({
    queryKey: qk.team,
    queryFn: () => tenantApi.get<TeamDashboard>('/api/team/dashboard'),
    enabled: me.isManager && can('evaluation:manage'),
  });
  const myItems = mine.data?.pages.flatMap((p) => p.items) ?? [];
  const latestScore = myItems.find((e) => e.finalScore !== null)?.finalScore ?? null;
  const showManager = me.isManager && can('evaluation:manage');

  return (
    <Page>
      <motion.section variants={fadeUp} className="relative overflow-hidden rounded-3xl bg-zinc-950 p-8 text-white shadow-pop">
        <Aurora className="opacity-80" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="flex items-center gap-2 text-sm text-white/70">
              <Sparkles className="size-4" /> {t('dash.welcome')}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{t('dash.hello', { name: me.user.fullName.split(' ')[0] ?? me.user.fullName })}</h1>
            <p className="mt-1 text-sm text-white/70">{me.tenant.name}</p>
          </div>
          {team.data?.cycle && (
            <div className="rounded-2xl bg-white/10 px-4 py-3 backdrop-blur">
              <div className="text-xs text-white/70">{t('dash.currentCycle')}</div>
              <div className="font-semibold">{team.data.cycle.name}</div>
            </div>
          )}
        </div>
      </motion.section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {can('evaluation:self') && <Stat label={t('dash.yourScore')} value={latestScore} decimals={2} icon={<Gauge className="size-4" />} hint="/ 100" accent />}
        {showManager && <Stat label={t('dash.teamAverage')} value={team.data?.averageFinalScore ?? null} decimals={2} icon={<UsersRound className="size-4" />} />}
        {showManager && <Stat label={t('reports.published')} value={team.data?.published ?? 0} icon={<ClipboardCheck className="size-4" />} />}
        {can('evaluation:approve') && <Stat label={t('dash.toReview')} value={approvals.data?.pages[0]?.items.length ?? 0} icon={<CheckCheck className="size-4" />} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {showManager && (
          <Card title={t('dash.teamProgress')} description={team.data?.cycle?.name} icon={<UsersRound className="size-4" />} className="lg:col-span-3">
            <QueryState isLoading={team.isLoading} error={team.error} onRetry={() => void team.refetch()} skeleton={<SkeletonRows rows={2} />}>
              {team.data?.cycle ? <StatusProgress byStatus={team.data.byStatus} /> : <EmptyState title={t('dash.noCycle')} />}
              {team.data?.cycle && (
                <Link to="/team" className="group mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-brand-text">
                  {t('nav.team')} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
                </Link>
              )}
            </QueryState>
          </Card>
        )}

        {can('evaluation:self') && (
          <Card title={t('dash.myEvaluation')} icon={<ClipboardCheck className="size-4" />} className={showManager ? 'lg:col-span-2' : 'lg:col-span-5'} padded={false}>
            <QueryState isLoading={mine.isLoading} error={mine.error} isEmpty={!myItems.length} skeleton={<div className="p-5"><SkeletonRows rows={3} cols={2} /></div>}>
              <ul className="divide-y divide-line">
                {myItems.map((e) => (
                  <li key={e.id}>
                    <Link to={`/evaluations/${e.id}`} className="group flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-surface-2/60">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-fg">{e.cycle.name}</div>
                        <div className="mt-1.5">
                          <StatusBadge status={e.status} />
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {e.finalScore !== null && <span className="text-lg font-semibold text-fg tabular">{formatNumber(e.finalScore)}</span>}
                        <ArrowRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </QueryState>
          </Card>
        )}
      </div>
    </Page>
  );
}
