import { useDeferredValue, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ScrollText, Search, ShieldAlert, Pencil } from 'lucide-react';
import type { AuditEntryView, Page as PageOf } from '@appraisal/contracts';
import { useI18n } from '../../shared/i18n/i18n';
import { tenantApi } from '../../shared/lib/api';
import { qk } from '../../shared/lib/query-keys';
import { Avatar, Badge, Button, Card, Input, Page, PageHeader, QueryState, Segmented, Table, Td, Tr } from '../../shared/ui';

/** TA-07: the tenant's append-only audit log: changes and security events. */
export default function AuditPage() {
  const { t, formatDateTime } = useI18n();
  const [category, setCategory] = useState<'' | 'CHANGE' | 'SECURITY'>('');
  const [action, setAction] = useState('');
  const deferredAction = useDeferredValue(action);
  const q = useInfiniteQuery({
    queryKey: qk.audit({ category, action: deferredAction }),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (category) params.set('category', category);
      if (deferredAction) params.set('action', deferredAction);
      if (pageParam) params.set('cursor', pageParam);
      return tenantApi.get<PageOf<AuditEntryView>>(`/api/audit?${params}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Page>
      <PageHeader title={t('nav.audit')} />
      <Card
        icon={<ScrollText className="size-4" />}
        title={t('nav.audit')}
        actions={
          <>
            <Segmented
              id="audit-cat"
              value={category}
              onChange={setCategory}
              options={[
                { value: '', label: t('audit.all') },
                { value: 'CHANGE', label: t('audit.changes') },
                { value: 'SECURITY', label: t('audit.security') },
              ]}
            />
            <div className="relative">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input aria-label={t('audit.action')} placeholder="evaluation." value={action} onChange={(e) => setAction(e.target.value)} className="w-44 ps-8" />
            </div>
          </>
        }
      >
        <QueryState isLoading={q.isLoading} error={q.error} isEmpty={!rows.length} onRetry={() => void q.refetch()}>
          <Table head={[t('audit.when'), t('audit.action'), t('audit.actor'), t('audit.entity'), t('audit.details')]}>
            {rows.map((r) => (
              <Tr key={r.id} className="align-top">
                <Td className="text-xs whitespace-nowrap text-muted tabular">{formatDateTime(r.createdAt)}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <Badge tone={r.category}>
                      {r.category === 'SECURITY' ? <ShieldAlert className="size-3" /> : <Pencil className="size-3" />}
                      {r.category === 'SECURITY' ? t('audit.security') : t('audit.changes')}
                    </Badge>
                    <code className="text-xs text-fg">{r.action}</code>
                  </div>
                </Td>
                <Td>
                  {r.actor ? (
                    <div className="flex items-center gap-2">
                      <Avatar name={r.actor.fullName} size="sm" />
                      <span className="text-sm">{r.actor.fullName}</span>
                    </div>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </Td>
                <Td className="text-xs text-muted">
                  {r.entityType}
                  {r.entityId && <div className="font-mono">{r.entityId.slice(0, 8)}…</div>}
                </Td>
                <Td>
                  <code className="block max-w-xs truncate rounded-md bg-surface-2 px-2 py-1 text-[11px] text-muted" title={JSON.stringify(r.metadata, null, 2)}>
                    {JSON.stringify(r.metadata)}
                  </code>
                </Td>
              </Tr>
            ))}
          </Table>
          {q.hasNextPage && (
            <Button variant="secondary" className="mt-4" busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              {t('audit.loadMore')}
            </Button>
          )}
        </QueryState>
      </Card>
    </Page>
  );
}
