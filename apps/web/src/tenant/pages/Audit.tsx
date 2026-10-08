import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { AuditEntryView, Page } from '@appraisal/contracts';
import { Badge, Button, Card, Input, PageHeader, QueryState, Select, Table, Td } from '../../components/ui';
import { useI18n } from '../../i18n/i18n';
import { tenantApi } from '../../lib/api';

/** TA-07: the tenant's append-only audit log, changes and security events. */
export default function AuditPage() {
  const { t, formatDateTime } = useI18n();
  const [category, setCategory] = useState('');
  const [action, setAction] = useState('');
  const q = useInfiniteQuery({
    queryKey: ['audit', category, action],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (category) params.set('category', category);
      if (action) params.set('action', action);
      if (pageParam) params.set('cursor', pageParam);
      return tenantApi.get<Page<AuditEntryView>>(`/api/audit?${params}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader title={t('nav.audit')} />
      <Card
        actions={
          <>
            <Select aria-label={t('app.status')} value={category} onChange={(e) => setCategory(e.target.value)} className="w-36">
              <option value="">{t('audit.all')}</option>
              <option value="CHANGE">{t('audit.changes')}</option>
              <option value="SECURITY">{t('audit.security')}</option>
            </Select>
            <Input aria-label={t('audit.action')} placeholder="evaluation." value={action} onChange={(e) => setAction(e.target.value)} className="w-48" />
          </>
        }
      >
        <QueryState isLoading={q.isLoading} error={q.error} isEmpty={!rows.length} onRetry={() => void q.refetch()}>
          <Table head={[t('audit.when'), '', t('audit.action'), t('audit.actor'), t('audit.entity'), t('audit.details')]}>
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <Td className="whitespace-nowrap text-slate-500">{formatDateTime(r.createdAt)}</Td>
                <Td>
                  <Badge tone={r.category}>{r.category === 'SECURITY' ? t('audit.security') : t('audit.changes')}</Badge>
                </Td>
                <Td>
                  <code className="text-xs">{r.action}</code>
                </Td>
                <Td>{r.actor?.fullName ?? '—'}</Td>
                <Td className="text-xs text-slate-500">
                  {r.entityType}
                  {r.entityId && <div className="font-mono">{r.entityId.slice(0, 8)}…</div>}
                </Td>
                <Td>
                  <code className="block max-w-sm truncate text-xs text-slate-600" title={JSON.stringify(r.metadata)}>
                    {JSON.stringify(r.metadata)}
                  </code>
                </Td>
              </tr>
            ))}
          </Table>
          {q.hasNextPage && (
            <Button variant="secondary" className="mt-4" busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              {t('audit.loadMore')}
            </Button>
          )}
        </QueryState>
      </Card>
    </>
  );
}
