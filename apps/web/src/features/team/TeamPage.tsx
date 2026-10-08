import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ArrowRight, ClipboardCheck, Gauge, UsersRound } from 'lucide-react';
import { useI18n } from '../../shared/i18n/i18n';
import { tenantApi } from '../../shared/lib/api';
import { qk } from '../../shared/lib/query-keys';
import { Avatar, Card, EmptyState, Page, PageHeader, QueryState, SkeletonCards, Stat, StatusBadge, Table, Td, Tr } from '../../shared/ui';
import { StatusProgress, type TeamDashboard } from '../dashboard/DashboardPage';

/** EV-08: the manager's team in the current cycle. */
export default function TeamPage() {
  const { t, formatNumber } = useI18n();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: qk.team, queryFn: () => tenantApi.get<TeamDashboard>('/api/team/dashboard') });
  const d = q.data;
  return (
    <Page>
      <PageHeader title={t('nav.team')} subtitle={d?.cycle ? `${t('dash.currentCycle')}: ${d.cycle.name}` : undefined} />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} skeleton={<SkeletonCards count={3} />}>
        {d && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label={t('dash.teamAverage')} value={d.averageFinalScore} decimals={2} icon={<Gauge className="size-4" />} accent />
              <Stat label={t('reports.published')} value={d.published} icon={<ClipboardCheck className="size-4" />} />
              <Stat label={t('dash.directReports')} value={d.directReports} icon={<UsersRound className="size-4" />} />
            </div>
            <Card title={t('dash.teamProgress')}>
              <StatusProgress byStatus={d.byStatus} />
            </Card>
            <Card>
              <QueryState isLoading={false} error={null} isEmpty={!d.team.length} empty={<EmptyState title={t('dash.noCycle')} />}>
                <Table head={[t('eval.employee'), t('app.status'), t('eval.finalScore'), '']}>
                  {d.team.map((row) => (
                    <Tr key={row.evaluationId} onClick={() => navigate(`/evaluations/${row.evaluationId}`)}>
                      <Td>
                        <div className="flex items-center gap-3">
                          <Avatar name={row.employee.fullName} size="sm" />
                          <span className="font-medium text-fg">{row.employee.fullName}</span>
                        </div>
                      </Td>
                      <Td>
                        <StatusBadge status={row.status} />
                      </Td>
                      <Td className="font-semibold tabular">{row.finalScore === null ? <span className="text-muted">—</span> : formatNumber(row.finalScore)}</Td>
                      <Td className="text-end">
                        <ArrowRight className="inline size-4 text-muted rtl:rotate-180" />
                      </Td>
                    </Tr>
                  ))}
                </Table>
              </QueryState>
            </Card>
          </>
        )}
      </QueryState>
    </Page>
  );
}
