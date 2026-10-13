import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { Check, CheckCheck, EyeOff, MessageSquareText, RotateCcw, Save, Send } from 'lucide-react';
import type { EvaluationDetailView, EvaluatorKind } from '@appraisal/contracts';
import { useI18n } from '../../shared/i18n/i18n';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CountUp,
  ErrorBox,
  Page,
  QueryState,
  Rating,
  Skeleton,
  StatusBadge,
  Textarea,
  fadeUp,
} from '../../shared/ui';
import { isStale, useEvaluation, useEvaluationAction } from './api';
import { Journey } from './Journey';

type Draft = Record<string, { score: number | ''; comment: string }>;

export default function EvaluationDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const q = useEvaluation(id);
  return (
    <QueryState
      isLoading={q.isLoading}
      error={q.error}
      onRetry={() => void q.refetch()}
      skeleton={
        <div className="space-y-6">
          <Skeleton className="h-24 w-full rounded-3xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      }
    >
      {q.data && <EvaluationView e={q.data} />}
    </QueryState>
  );
}

/** Final score as an animated ring: the one number this page exists for. */
function ScoreRing({ value }: { value: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-24">
      <svg viewBox="0 0 80 80" className="size-24 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--border)" strokeWidth="6" />
        <motion.circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="var(--brand)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - value / 100) }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-xl font-semibold text-fg tabular">
        <CountUp value={value} decimals={value % 1 ? 1 : 0} />
      </div>
    </div>
  );
}

function EvaluationView({ e }: { e: EvaluationDetailView }) {
  const { t, formatDateTime } = useI18n();
  const action = useEvaluationAction(e.id, e.version);
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
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const filled = Object.values(draft).filter((d) => d.score !== '').length;
  const body = () => ({
    scores: Object.entries(draft)
      .filter(([, v]) => v.score !== '')
      .map(([competencyId, v]) => ({ competencyId, score: Number(v.score), comment: v.comment.trim() || null })),
  });
  const run = (a: Parameters<typeof action.mutate>[0], message: string) =>
    action.mutate(a, {
      onSuccess: () => {
        toast.success(message);
        setRejecting(false);
        setReason('');
      },
    });

  const scoreOf = (competencyId: string, kind: EvaluatorKind) => e.scores.find((s) => s.competencyId === competencyId && s.evaluator === kind);
  const showSelf = e.policy.selfAssessmentRequired;
  const showManager = e.scores.some((s) => s.evaluator === 'MANAGER') || editing === 'MANAGER';

  return (
    <Page>
      <motion.section variants={fadeUp} className="rounded-3xl border border-line bg-surface p-6 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-center gap-4">
            <Avatar name={e.employee.fullName} />
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-fg">{e.employee.fullName}</h1>
              <p className="mt-0.5 text-sm text-muted">
                {e.cycle.name} · {t('eval.manager')}: {e.manager?.fullName ?? '—'}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <StatusBadge status={e.status} />
                <Badge>{t('eval.scale', { min: e.policy.scale.min, max: e.policy.scale.max })}</Badge>
                <Badge>
                  {t('eval.selfRequired')}: {e.policy.selfAssessmentRequired ? t('app.yes') : t('app.no')}
                </Badge>
                <Badge>
                  {t('eval.approvalRequired')}: {e.policy.approvalRequired ? t(`eval.strategy.${e.policy.approvalStrategy}`) : t('app.no')}
                </Badge>
              </div>
            </div>
          </div>
          {e.finalScore !== null && (
            <div className="flex items-center gap-3">
              <div className="text-end text-xs text-muted">
                {t('eval.finalScore')}
                <div className="text-[10px]">/ 100</div>
              </div>
              <ScoreRing value={e.finalScore} />
            </div>
          )}
        </div>
        <div className="mt-8">
          <div className="mb-3 text-xs font-medium text-muted">{t('eval.journey')}</div>
          <Journey policy={e.policy} status={e.status} />
        </div>
      </motion.section>

      {e.status === 'PUBLISHED' && e.finalScore === null && !e.resultVisibleToEmployee && (
        <motion.div variants={fadeUp} className="flex items-center gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] p-4 text-sm text-amber-800 dark:text-amber-300">
          <EyeOff className="size-4 shrink-0" /> {t('eval.hiddenResult')}
        </motion.div>
      )}

      <Card
        title={t('cycles.competencies')}
        description={editing ? `${filled} / ${e.competencies.length}` : undefined}
        actions={
          editing && (
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-surface-2">
              <motion.div className="h-full rounded-full bg-brand" animate={{ width: `${(filled / Math.max(1, e.competencies.length)) * 100}%` }} transition={{ type: 'spring', stiffness: 200, damping: 30 }} />
            </div>
          )
        }
      >
        <div className="space-y-3">
          {e.competencies.map((c, idx) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="rounded-xl border border-line p-4 transition-colors hover:border-zinc-400/50"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-fg">{c.name}</span>
                    <Badge tone="BRAND">{c.weight}%</Badge>
                  </div>
                  {c.description && <p className="mt-1 text-xs text-muted">{c.description}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-5">
                  {showSelf && editing !== 'SELF' && <ReadOnlyScore label={t('eval.self')} value={scoreOf(c.id, 'SELF')?.score} />}
                  {showManager && editing !== 'MANAGER' && <ReadOnlyScore label={t('eval.managerScore')} value={scoreOf(c.id, 'MANAGER')?.score} comment={scoreOf(c.id, 'MANAGER')?.comment} />}
                  {editing && (
                    <Rating
                      label={c.name}
                      min={e.policy.scale.min}
                      max={e.policy.scale.max}
                      value={draft[c.id]?.score ?? ''}
                      onChange={(score) => setDraft({ ...draft, [c.id]: { ...draft[c.id]!, score } })}
                    />
                  )}
                </div>
              </div>
              {editing && (
                <div className="mt-3 flex items-start gap-2">
                  <MessageSquareText className="mt-2.5 size-4 shrink-0 text-muted" />
                  <Textarea
                    aria-label={`${t('eval.comment')}: ${c.name}`}
                    rows={1}
                    maxLength={2000}
                    placeholder={t('eval.comment')}
                    value={draft[c.id]?.comment ?? ''}
                    onChange={(ev) => setDraft({ ...draft, [c.id]: { ...draft[c.id]!, comment: ev.target.value } })}
                  />
                </div>
              )}
            </motion.div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-5">
          {editing && (
            <>
              <Button variant="secondary" icon={<Save className="size-4" />} disabled={filled === 0} busy={action.isPending && action.variables?.kind === 'save'} onClick={() => run({ kind: 'save', evaluator: editing, body: body() }, t('app.saved'))}>
                {t('eval.saveDraft')}
              </Button>
              <Button icon={<Send className="size-4 rtl:-scale-x-100" />} busy={action.isPending && action.variables?.kind === 'submit'} onClick={() => run({ kind: 'submit', evaluator: editing, body: filled ? body() : {} }, t('toast.submitted'))}>
                {editing === 'SELF' ? t('eval.submitSelf') : t('eval.submitManager')}
              </Button>
            </>
          )}
          {e.allowedActions.includes('APPROVE') && (
            <>
              <Button icon={<CheckCheck className="size-4" />} busy={action.isPending && action.variables?.kind === 'approve'} onClick={() => run({ kind: 'approve' }, t('toast.approved'))}>
                {t('eval.approve')}
              </Button>
              <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={() => setRejecting((r) => !r)}>
                {t('eval.reject')}
              </Button>
            </>
          )}
          {!e.allowedActions.length && <p className="text-sm text-muted">{t('eval.noActions')}</p>}
        </div>
        <AnimatePresence>
          {rejecting && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="mt-4 space-y-2">
                <label className="block text-xs font-medium text-muted" htmlFor="reject-reason">
                  {t('eval.rejectReason')}
                </label>
                <Textarea id="reject-reason" rows={3} value={reason} onChange={(ev) => setReason(ev.target.value)} />
                <Button variant="danger" busy={action.isPending && action.variables?.kind === 'reject'} disabled={reason.trim().length < 3} onClick={() => run({ kind: 'reject', reason }, t('toast.rejected'))}>
                  {t('eval.reject')}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {action.error && (
          <div className="mt-4">
            {isStale(action.error) ? (
              <p role="alert" className="rounded-xl bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">
                {t('eval.stale')}
              </p>
            ) : (
              <ErrorBox error={action.error} />
            )}
          </div>
        )}
      </Card>

      {e.approvals.length > 0 && (
        <Card title={t('eval.approvals')}>
          <ol className="relative space-y-5 border-s border-line ps-6">
            {e.approvals.map((a, i) => (
              <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }} className="relative">
                <span className={`absolute -start-[31px] top-0.5 grid size-5 place-items-center rounded-full ring-4 ring-surface ${a.decision === 'APPROVED' ? 'bg-emerald-500' : 'bg-red-500'} text-white`}>
                  {a.decision === 'APPROVED' ? <Check className="size-3" /> : <RotateCcw className="size-3" />}
                </span>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-fg">{a.approver.fullName}</span>
                  <Badge tone={a.decision === 'APPROVED' ? 'PUBLISHED' : 'SUSPENDED'}>{a.decision === 'APPROVED' ? t('eval.approve') : t('eval.reject')}</Badge>
                  <span className="text-xs text-muted">{t('eval.stage', { n: a.stage })}</span>
                  <span className="text-xs text-muted">· {formatDateTime(a.createdAt)}</span>
                </div>
                {a.comment && <p className="mt-1 text-sm text-muted">“{a.comment}”</p>}
              </motion.li>
            ))}
          </ol>
        </Card>
      )}
    </Page>
  );
}

function ReadOnlyScore({ label, value, comment }: { label: string; value: number | undefined; comment?: string | null | undefined }) {
  const { formatNumber } = useI18n();
  return (
    <div className="text-center" title={comment ?? undefined}>
      <div className="text-[10px] font-medium tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-fg tabular">{value === undefined ? <span className="text-muted">—</span> : formatNumber(value)}</div>
    </div>
  );
}
