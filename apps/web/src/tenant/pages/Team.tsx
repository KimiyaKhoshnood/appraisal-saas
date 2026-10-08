import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { EvaluationStatus } from '@appraisal/contracts';
import { Card, PageHeader, QueryState, Stat, StatusBadge, Table, Td } from '../../components/ui';
import { useI18n } from '../../i18n/i18n';
import { tenantApi } from '../../lib/api';
import type { TeamDashboard } from './Dashboard';

/** EV-08: the manager's team in the current cycle. */
export default function TeamPage() {
  const { t, formatNumber, formatDateTime } = useI18n();
  const q = useQuery({ queryKey: ['team', 'dashboard'], queryFn: () => tenantApi.get<TeamDashboard>('/api/team/dashboard') });
  const d = q.data;
  return (
    <>
      <PageHeader title={t('nav.team')} subtitle={d?.cycle ? `${t('dash.currentCycle')}: ${d.cycle.name}` : undefined} />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {d && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
              {(Object.keys(d.byStatus) as EvaluationStatus[]).map((s) => (
                <Stat key={s} label={t(`status.${s}`)} value={formatNumber(d.byStatus[s])} />
              ))}
              <Stat label={t('reports.average')} value={d.averageFinalScore === null ? '—' : formatNumber(d.averageFinalScore)} />
            </div>
            <Card>
              <QueryState isLoading={false} error={null} isEmpty={!d.team.length}>
                <Table head={[t('eval.employee'), t('app.status'), t('eval.finalScore'), '']}>
                  {d.team.map((row) => (
                    <tr key={row.evaluationId}>
                      <Td>{row.employee.fullName}</Td>
                      <Td>
                        <StatusBadge status={row.status} />
                      </Td>
                      <Td>{row.finalScore === null ? '—' : formatNumber(row.finalScore)}</Td>
                      <Td className="text-end">
                        <Link className="text-sm font-medium text-brand hover:underline" to={`/evaluations/${row.evaluationId}`} title={formatDateTime(row.updatedAt)}>
                          {t('dash.open')}
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </Table>
              </QueryState>
            </Card>
          </div>
        )}
      </QueryState>
    </>
  );
}
