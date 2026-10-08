import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import type { EvaluationDetailView, EvaluatorKind } from '@appraisal/contracts';
import { Badge, Button, Card, ErrorBox, PageHeader, QueryState, Select, StatusBadge, Table, Td } from '../../components/ui';
import { useI18n } from '../../i18n/i18n';
import { tenantApi } from '../../lib/api';

type Draft = Record<string, { score: number | ''; comment: string }>;

export default function EvaluationDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['evaluation', id], queryFn: () => tenantApi.get<EvaluationDetailView>(`/api/evaluations/${id}`) });
  return (
    <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
      {q.data ? <EvaluationView e={q.data} /> : <p>{t('app.empty')}</p>}
    </QueryState>
  );
}

function EvaluationView({ e }: { e: EvaluationDetailView }) {
  const { t, formatNumber, formatDateTime } = useI18n();
  const qc = useQueryClient();
  const editing: EvaluatorKind | null = e.allowedActions.includes('SAVE_SELF') ? 'SELF' : e.allowedActions.includes('SAVE_MANAGER') ? 'MANAGER' : null;

  const initial = useMemo<Draft>(() => {
    const d: Draft = {};
    for (const c of e.competencies) {
      const existing = e.scores.find((s) => s.competencyId === c.id && s.evaluator === editing);
      d[c.id] = { score: existing?.score ?? '', comment: existing?.comment ?? '' };
    }
    return d;
  }, [e, editing]);
  const [draft, setDraft] = useState<Draft>(initial);
  useEffect(() => setDraft(initial), [initial]);
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const payload = () => ({
    scores: Object.entries(draft)
      .filter(([, v]) => v.score !== '')
      .map(([competencyId, v]) => ({ competencyId, score: Number(v.score), comment: v.comment.trim() || null })),
  });
  const onDone = (data: EvaluationDetailView) => {
    qc.setQueryData(['evaluation', e.id], data);
    void qc.invalidateQueries({ queryKey: ['evaluations'] });
    void qc.invalidateQueries({ queryKey: ['team'] });
  };
  const base = `/api/evaluations/${e.id}`;
  const save = useMutation({
    mutationFn: () => tenantApi.put<EvaluationDetailView>(`${base}/${editing === 'SELF' ? 'self' : 'manager'}-scores`, payload()),
    onSuccess: onDone,
  });
  const submit = useMutation({
    mutationFn: () => tenantApi.post<EvaluationDetailView>(`${base}/${editing === 'SELF' ? 'self' : 'manager'}-submit`, payload()),
    onSuccess: onDone,
  });
  const approve = useMutation({ mutationFn: () => tenantApi.post<EvaluationDetailView>(`${base}/approve`, {}), onSuccess: onDone });
  const reject = useMutation({
    mutationFn: () => tenantApi.post<EvaluationDetailView>(`${base}/reject`, { reason }),
    onSuccess: (d) => {
      setRejecting(false);
      setReason('');
      onDone(d);
    },
  });
  const error = save.error ?? submit.error ?? approve.error ?? reject.error;

  const scoreOf = (competencyId: string, kind: EvaluatorKind) => e.scores.find((s) => s.competencyId === competencyId && s.evaluator === kind);
  const scale = Array.from({ length: e.policy.scale.max - e.policy.scale.min + 1 }, (_, i) => e.policy.scale.min + i);
  const showManagerColumn = e.scores.some((s) => s.evaluator === 'MANAGER') || editing === 'MANAGER';

  return (
    <>
      <PageHeader
        title={e.employee.fullName}
        subtitle={`${t('eval.cycle')}: ${e.cycle.name} · ${t('eval.manager')}: ${e.manager?.fullName ?? '—'}`}
        actions={<StatusBadge status={e.status} />}
      />

      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">{t('eval.policy')}:</span>
        <Badge tone="DRAFT">{t('eval.scale', { min: e.policy.scale.min, max: e.policy.scale.max })}</Badge>
        <Badge tone="DRAFT">
          {t('eval.selfRequired')}: {e.policy.selfAssessmentRequired ? t('app.yes') : t('app.no')}
        </Badge>
        <Badge tone="DRAFT">
          {t('eval.approvalRequired')}: {e.policy.approvalRequired ? t(`eval.strategy.${e.policy.approvalStrategy}`) : t('app.no')}
        </Badge>
      </div>

      {e.finalScore !== null && (
        <Card className="mb-6">
          <div className="flex items-baseline gap-3">
            <span className="text-sm text-slate-500">{t('eval.finalScore')}</span>
            <span className="text-4xl font-semibold text-brand">{formatNumber(e.finalScore)}</span>
            <span className="text-sm text-slate-400">/ 100</span>
          </div>
        </Card>
      )}
      {e.status === 'PUBLISHED' && e.finalScore === null && !e.resultVisibleToEmployee && (
        <p className="mb-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">{t('eval.hiddenResult')}</p>
      )}

      <Card title={t('cycles.competencies')}>
        <Table
          head={[
            t('eval.competency'),
            t('eval.weight'),
            ...(e.policy.selfAssessmentRequired ? [t('eval.self')] : []),
            ...(showManagerColumn ? [t('eval.managerScore')] : []),
            ...(editing ? [t('eval.comment')] : []),
          ]}
        >
          {e.competencies.map((c) => (
            <tr key={c.id}>
              <Td>
                <div className="font-medium">{c.name}</div>
                {c.description && <div className="text-xs text-slate-500">{c.description}</div>}
              </Td>
              <Td>{formatNumber(c.weight)}%</Td>
              {e.policy.selfAssessmentRequired && (
                <Td>
                  {editing === 'SELF' ? (
                    <ScoreSelect value={draft[c.id]?.score ?? ''} options={scale} onChange={(score) => setDraft({ ...draft, [c.id]: { ...draft[c.id]!, score } })} label={c.name} />
                  ) : (
                    <ScoreValue s={scoreOf(c.id, 'SELF')} />
                  )}
                </Td>
              )}
              {showManagerColumn && (
                <Td>
                  {editing === 'MANAGER' ? (
                    <ScoreSelect value={draft[c.id]?.score ?? ''} options={scale} onChange={(score) => setDraft({ ...draft, [c.id]: { ...draft[c.id]!, score } })} label={c.name} />
                  ) : (
                    <ScoreValue s={scoreOf(c.id, 'MANAGER')} />
                  )}
                </Td>
              )}
              {editing && (
                <Td>
                  <textarea
                    aria-label={`${t('eval.comment')}: ${c.name}`}
                    rows={1}
                    maxLength={2000}
                    className="focus-ring w-full min-w-48 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                    value={draft[c.id]?.comment ?? ''}
                    onChange={(ev) => setDraft({ ...draft, [c.id]: { ...draft[c.id]!, comment: ev.target.value } })}
                  />
                </Td>
              )}
            </tr>
          ))}
        </Table>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {editing && (
            <>
              <Button variant="secondary" busy={save.isPending} onClick={() => save.mutate()}>
                {t('eval.saveDraft')}
              </Button>
              <Button busy={submit.isPending} onClick={() => submit.mutate()}>
                {editing === 'SELF' ? t('eval.submitSelf') : t('eval.submitManager')}
              </Button>
            </>
          )}
          {e.allowedActions.includes('APPROVE') && (
            <>
              <Button busy={approve.isPending} onClick={() => approve.mutate()}>
                {t('eval.approve')}
              </Button>
              <Button variant="secondary" onClick={() => setRejecting((r) => !r)}>
                {t('eval.reject')}
              </Button>
            </>
          )}
          {!e.allowedActions.length && <p className="text-sm text-slate-500">{t('eval.noActions')}</p>}
        </div>
        {rejecting && (
          <div className="mt-4 space-y-2">
            <label className="block text-sm font-medium" htmlFor="reject-reason">
              {t('eval.rejectReason')}
            </label>
            <textarea id="reject-reason" className="focus-ring w-full rounded-lg border border-slate-300 p-2 text-sm" rows={3} value={reason} onChange={(ev) => setReason(ev.target.value)} />
            <Button variant="danger" busy={reject.isPending} disabled={reason.trim().length < 3} onClick={() => reject.mutate()}>
              {t('eval.reject')}
            </Button>
          </div>
        )}
        {error && (
          <div className="mt-4">
            <ErrorBox error={error} />
          </div>
        )}
      </Card>

      {e.approvals.length > 0 && (
        <Card title={t('eval.approvals')} className="mt-6">
          <ul className="space-y-3">
            {e.approvals.map((a, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 text-sm">
                <Badge tone={a.decision === 'APPROVED' ? 'PUBLISHED' : 'SUSPENDED'}>{a.decision === 'APPROVED' ? t('eval.approve') : t('eval.reject')}</Badge>
                <span className="font-medium">{a.approver.fullName}</span>
                <span className="text-slate-500">{t('eval.stage', { n: a.stage })}</span>
                <span className="text-slate-400">{formatDateTime(a.createdAt)}</span>
                {a.comment && <span className="text-slate-600">“{a.comment}”</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function ScoreSelect({ value, options, onChange, label }: { value: number | ''; options: number[]; onChange: (v: number | '') => void; label: string }) {
  const { formatNumber } = useI18n();
  return (
    <Select aria-label={label} value={value} onChange={(ev) => onChange(ev.target.value === '' ? '' : Number(ev.target.value))} className="w-24">
      <option value="">—</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {formatNumber(o)}
        </option>
      ))}
    </Select>
  );
}

function ScoreValue({ s }: { s: { score: number; comment: string | null } | undefined }) {
  const { formatNumber } = useI18n();
  if (!s) return <span className="text-slate-400">—</span>;
  return (
    <span title={s.comment ?? undefined} className="font-medium">
      {formatNumber(s.score)}
      {s.comment && <span className="ms-1 text-slate-400">✎</span>}
    </span>
  );
}
