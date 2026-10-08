import { useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarRange, Lock, Play, Plus, Square, Trash2 } from 'lucide-react';
import type { CycleView } from '@appraisal/contracts';
import { useI18n } from '../../shared/i18n/i18n';
import { tenantApi } from '../../shared/lib/api';
import { qk } from '../../shared/lib/query-keys';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Page, PageHeader, QueryState, StatusBadge } from '../../shared/ui';

export default function CyclesPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.cycles, queryFn: () => tenantApi.get<CycleView[]>('/api/cycles') });
  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState(new Date().toISOString().slice(0, 10));
  const create = useMutation({
    mutationFn: () => tenantApi.post<CycleView>('/api/cycles', { name, startsOn }),
    onSuccess: () => {
      setName('');
      toast.success(t('app.saved'));
      void qc.invalidateQueries({ queryKey: qk.cycles });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <Page>
      <PageHeader title={t('nav.cycles')} subtitle={t('cycles.frozenPolicy')} />
      <Card title={t('cycles.new')} icon={<Plus className="size-4" />}>
        <form onSubmit={submit} className="grid items-end gap-4 md:grid-cols-[1fr_200px_auto]">
          <Field label={t('app.name')}>{(id) => <Input id={id} required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label={t('cycles.startsOn')}>{(id) => <Input id={id} type="date" required value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />}</Field>
          <Button type="submit" busy={create.isPending} icon={<Plus className="size-4" />}>
            {t('app.create')}
          </Button>
        </form>
        {create.error && (
          <div className="mt-4">
            <ErrorBox error={create.error} />
          </div>
        )}
      </Card>
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={!q.data?.length} onRetry={() => void q.refetch()} empty={<EmptyState title={t('app.empty')} icon={<CalendarRange className="size-5" />} />}>
        <div className="space-y-4">{q.data?.map((c) => <CycleCard key={c.id} cycle={c} />)}</div>
      </QueryState>
    </Page>
  );
}

function CycleCard({ cycle }: { cycle: CycleView }) {
  const { t, formatDate, formatNumber } = useI18n();
  const qc = useQueryClient();
  const [rows, setRows] = useState(cycle.competencies.map((c) => ({ name: c.name, description: c.description ?? '', weight: c.weight })));
  const total = rows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.cycles });
    void qc.invalidateQueries({ queryKey: qk.evaluations.all });
  };
  const ok = (msg: string) => () => {
    toast.success(msg);
    refresh();
  };
  const saveCompetencies = useMutation({
    mutationFn: () =>
      tenantApi.put(`/api/cycles/${cycle.id}/competencies`, {
        competencies: rows.map((r) => ({ name: r.name, description: r.description || null, weight: Number(r.weight) })),
      }),
    onSuccess: ok(t('app.saved')),
  });
  const activate = useMutation({ mutationFn: () => tenantApi.post(`/api/cycles/${cycle.id}/activate`), onSuccess: ok(t('cycles.activate')) });
  const close = useMutation({ mutationFn: () => tenantApi.post(`/api/cycles/${cycle.id}/close`), onSuccess: ok(t('cycles.close')) });
  const editable = cycle.status === 'DRAFT';
  const error = saveCompetencies.error ?? activate.error ?? close.error;

  return (
    <Card
      icon={<CalendarRange className="size-4" />}
      title={
        <span className="flex items-center gap-2">
          {cycle.name} <StatusBadge status={cycle.status} />
        </span>
      }
      description={`${formatDate(cycle.startsOn)} → ${formatDate(cycle.endsOn)} · ${t('cycles.evaluations', { n: formatNumber(cycle.evaluationCount) })}`}
      actions={
        <>
          {editable && (
            <Button size="sm" busy={activate.isPending} onClick={() => activate.mutate()} icon={<Play className="size-3.5" />}>
              {t('cycles.activate')}
            </Button>
          )}
          {cycle.status === 'ACTIVE' && (
            <Button size="sm" variant="secondary" busy={close.isPending} onClick={() => close.mutate()} icon={<Square className="size-3.5" />}>
              {t('cycles.close')}
            </Button>
          )}
        </>
      }
    >
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Badge>{t('eval.scale', { min: cycle.policy.scale.min, max: cycle.policy.scale.max })}</Badge>
        <Badge>
          {t('eval.selfRequired')}: {cycle.policy.selfAssessmentRequired ? t('app.yes') : t('app.no')}
        </Badge>
        <Badge>
          {t('eval.approvalRequired')}: {cycle.policy.approvalRequired ? t(`eval.strategy.${cycle.policy.approvalStrategy}`) : t('app.no')}
        </Badge>
        {!editable && (
          <Badge>
            <Lock className="size-3" /> {t('cycles.frozenPolicy')}
          </Badge>
        )}
      </div>
      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {rows.map((r, i) => (
            <motion.div key={i} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="grid gap-2 md:grid-cols-[1fr_2fr_96px_auto]">
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
              {editable ? (
                <Button variant="ghost" aria-label={t('app.delete')} onClick={() => setRows(rows.filter((_, j) => j !== i))} icon={<Trash2 className="size-4" />} />
              ) : (
                <span />
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {editable && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" icon={<Plus className="size-3.5" />} onClick={() => setRows([...rows, { name: '', description: '', weight: 10 }])}>
            {t('cycles.addCompetency')}
          </Button>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-2">
              <motion.div className={total === 100 ? 'h-full bg-emerald-500' : 'h-full bg-amber-500'} animate={{ width: `${Math.min(100, total)}%` }} />
            </div>
            <span className={total === 100 ? 'text-xs font-medium text-emerald-600' : 'text-xs font-medium text-amber-600'}>{t('cycles.weightsTotal', { n: total })}</span>
          </div>
          <Button size="sm" busy={saveCompetencies.isPending} disabled={total !== 100} onClick={() => saveCompetencies.mutate()}>
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
