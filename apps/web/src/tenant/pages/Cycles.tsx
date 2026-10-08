import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CycleView } from '@appraisal/contracts';
import { Button, Card, ErrorBox, Field, Input, PageHeader, QueryState, StatusBadge } from '../../components/ui';
import { useI18n } from '../../i18n/i18n';
import { tenantApi } from '../../lib/api';

export default function CyclesPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cycles'], queryFn: () => tenantApi.get<CycleView[]>('/api/cycles') });
  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState(new Date().toISOString().slice(0, 10));
  const create = useMutation({
    mutationFn: () => tenantApi.post<CycleView>('/api/cycles', { name, startsOn }),
    onSuccess: () => {
      setName('');
      void qc.invalidateQueries({ queryKey: ['cycles'] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <>
      <PageHeader title={t('nav.cycles')} subtitle={t('cycles.frozenPolicy')} />
      <Card title={t('cycles.new')} className="mb-6">
        <form onSubmit={submit} className="grid items-end gap-4 md:grid-cols-[1fr_200px_auto]">
          <Field label={t('app.name')}>{(id) => <Input id={id} required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label={t('cycles.startsOn')}>{(id) => <Input id={id} type="date" required value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />}</Field>
          <Button type="submit" busy={create.isPending}>
            {t('app.create')}
          </Button>
        </form>
        {create.error && (
          <div className="mt-4">
            <ErrorBox error={create.error} />
          </div>
        )}
      </Card>
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={!q.data?.length} onRetry={() => void q.refetch()}>
        <div className="space-y-4">
          {q.data?.map((c) => <CycleCard key={c.id} cycle={c} />)}
        </div>
      </QueryState>
    </>
  );
}

function CycleCard({ cycle }: { cycle: CycleView }) {
  const { t, formatDate, formatNumber } = useI18n();
  const qc = useQueryClient();
  const [rows, setRows] = useState(cycle.competencies.map((c) => ({ name: c.name, description: c.description ?? '', weight: c.weight })));
  const total = rows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['cycles'] });
    void qc.invalidateQueries({ queryKey: ['evaluations'] });
  };
  const saveCompetencies = useMutation({
    mutationFn: () =>
      tenantApi.put(`/api/cycles/${cycle.id}/competencies`, {
        competencies: rows.map((r) => ({ name: r.name, description: r.description || null, weight: Number(r.weight) })),
      }),
    onSuccess: refresh,
  });
  const activate = useMutation({ mutationFn: () => tenantApi.post(`/api/cycles/${cycle.id}/activate`), onSuccess: refresh });
  const close = useMutation({ mutationFn: () => tenantApi.post(`/api/cycles/${cycle.id}/close`), onSuccess: refresh });
  const editable = cycle.status === 'DRAFT';
  const error = saveCompetencies.error ?? activate.error ?? close.error;

  return (
    <Card
      title={
        <span className="flex items-center gap-3">
          {cycle.name} <StatusBadge status={cycle.status} />
        </span>
      }
      actions={
        <>
          {editable && (
            <Button busy={activate.isPending} onClick={() => activate.mutate()}>
              {t('cycles.activate')}
            </Button>
          )}
          {cycle.status === 'ACTIVE' && (
            <Button variant="secondary" busy={close.isPending} onClick={() => close.mutate()}>
              {t('cycles.close')}
            </Button>
          )}
        </>
      }
    >
      <p className="mb-4 text-sm text-slate-500">
        {formatDate(cycle.startsOn)} → {formatDate(cycle.endsOn)} · {t('cycles.evaluations', { n: formatNumber(cycle.evaluationCount) })} ·{' '}
        {t('eval.scale', { min: cycle.policy.scale.min, max: cycle.policy.scale.max })} · {t('eval.approvalRequired')}:{' '}
        {cycle.policy.approvalRequired ? t(`eval.strategy.${cycle.policy.approvalStrategy}`) : t('app.no')}
      </p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 md:grid-cols-[1fr_2fr_100px_auto]">
            <Input aria-label={t('app.name')} value={r.name} disabled={!editable} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <Input aria-label="Description" value={r.description} disabled={!editable} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
            <Input
              aria-label={t('eval.weight')}
              type="number"
              min={1}
              max={100}
              value={r.weight}
              disabled={!editable}
              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))}
            />
            {editable && (
              <Button variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                ✕
              </Button>
            )}
          </div>
        ))}
      </div>
      {editable && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => setRows([...rows, { name: '', description: '', weight: 10 }])}>
            {t('cycles.addCompetency')}
          </Button>
          <span className={total === 100 ? 'text-sm text-emerald-700' : 'text-sm font-medium text-red-700'}>{t('cycles.weightsTotal', { n: total })}</span>
          <Button busy={saveCompetencies.isPending} disabled={total !== 100} onClick={() => saveCompetencies.mutate()}>
            {t('app.save')}
          </Button>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <ErrorBox error={error} />
        </div>
      )}
    </Card>
  );
}
