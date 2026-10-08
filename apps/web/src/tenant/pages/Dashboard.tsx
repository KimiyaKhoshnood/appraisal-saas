import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { EvaluationStatus, EvaluationSummaryView, Page } from '@appraisal/contracts';
import { Card, PageHeader, QueryState, Stat, StatusBadge } from '../../components/ui';
import { useI18n } from '../../i18n/i18n';
import { tenantApi } from '../../lib/api';
import { useMe } from '../session';

export interface TeamDashboard {
  cycle: { id: string; name: string; status: string } | null;
  byStatus: Record<EvaluationStatus, number>;
  published: number;
  averageFinalScore: number | null;
  directReports: number;
  team: { evaluationId: string; employee: { id: string; fullName: string }; status: EvaluationStatus; finalScore: number | null; updatedAt: string }[];
}

export default function Dashboard() {
  const { me, can } = useMe();
  const { t, formatNumber } = useI18n();
  const mine = useQuery({
    queryKey: ['evaluations', 'mine', 'dashboard'],
    queryFn: () => tenantApi.get<Page<EvaluationSummaryView>>('/api/evaluations?scope=mine&limit=5'),
    enabled: can('evaluation:self'),
  });
  const team = useQuery({
    queryKey: ['team', 'dashboard'],
    queryFn: () => tenantApi.get<TeamDashboard>('/api/team/dashboard'),
    enabled: me.isManager && can('evaluation:manage'),
  });
  const approvals = useQuery({
    queryKey: ['evaluations', 'approvals'],
    queryFn: () => tenantApi.get<Page<EvaluationSummaryView>>('/api/evaluations?scope=approvals&limit=50'),
    enabled: can('evaluation:approve'),
  });

  return (
    <>
      <PageHeader title={t('dash.hello', { name: me.user.fullName })} subtitle={me.tenant.name} />
      <div className="grid gap-6 lg:grid-cols-2">
        {can('evaluation:self') && (
          <Card title={t('dash.myEvaluation')}>
            <QueryState isLoading={mine.isLoading} error={mine.error} isEmpty={!mine.data?.items.length} onRetry={() => void mine.refetch()}>
              <ul className="divide-y divide-slate-100">
                {mine.data?.items.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <div className="font-medium">{e.cycle.name}</div>
                      <div className="mt-1">
                        <StatusBadge status={e.status} />
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {e.finalScore !== null && <span className="text-lg font-semibold">{formatNumber(e.finalScore)}</span>}
                      <Link className="text-sm font-medium text-brand hover:underline" to={`/evaluations/${e.id}`}>
                        {t('dash.open')}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </QueryState>
          </Card>
        )}

        {can('evaluation:approve') && (
          <Card title={t('dash.pendingApprovals')}>
            <QueryState isLoading={approvals.isLoading} error={approvals.error}>
              <div className="flex items-center justify-between">
                <span className="text-4xl font-semibold">{formatNumber(approvals.data?.items.length ?? 0)}</span>
                <Link className="text-sm font-medium text-brand hover:underline" to="/approvals">
                  {t('nav.approvals')}
                </Link>
              </div>
            </QueryState>
          </Card>
        )}

        {me.isManager && can('evaluation:manage') && (
          <Card title={t('dash.teamProgress')} className="lg:col-span-2">
            <QueryState isLoading={team.isLoading} error={team.error} onRetry={() => void team.refetch()}>
              {team.data?.cycle ? (
                <>
                  <p className="mb-4 text-sm text-slate-500">
                    {t('dash.currentCycle')}: <span className="font-medium text-slate-800">{team.data.cycle.name}</span>
                  </p>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                    {(Object.keys(team.data.byStatus) as EvaluationStatus[]).map((s) => (
                      <Stat key={s} label={t(`status.${s}`)} value={formatNumber(team.data!.byStatus[s])} />
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500">{t('dash.noCycle')}</p>
              )}
            </QueryState>
          </Card>
        )}
      </div>
    </>
  );
}
