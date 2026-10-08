import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  APPROVAL_STRATEGIES,
  CYCLE_CADENCES,
  MIN_CONTRAST,
  RESULT_VISIBILITY,
  contrastRatio,
  type Branding,
  type EvaluationPolicy,
  type EvaluationPolicyOverride,
  type PlanPolicyLimits,
} from '@appraisal/contracts';
import { Button, Card, ErrorBox, Field, Input, PageHeader, QueryState, Select, Toggle } from '../../components/ui';
import { useI18n } from '../../i18n/i18n';
import { ApiError, tenantApi } from '../../lib/api';
import { applyBranding } from '../../lib/theme';
import { useMe } from '../session';

export default function SettingsPage() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t('nav.settings')} />
      <div className="space-y-6">
        <BrandingCard />
        <FeaturesCard />
        <PolicyCard />
      </div>
    </>
  );
}

function BrandingCard() {
  const { t } = useI18n();
  const { can, me, reloadContext } = useMe();
  const [b, setB] = useState<Branding>(me.branding);
  useEffect(() => setB(me.branding), [me.branding]);
  // Live preview: theme the page while editing, restore on leave.
  useEffect(() => {
    applyBranding(b);
    return () => applyBranding(me.branding);
  }, [b, me.branding]);
  const save = useMutation({ mutationFn: () => tenantApi.put<Branding>('/api/config/branding', b), onSuccess: () => void reloadContext() });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};
  const ratio = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? contrastRatio(c, '#ffffff') : 0);
  const disabled = !can('config:write');

  const colour = (key: 'primaryColor' | 'secondaryColor', label: string) => {
    const r = ratio(b[key]);
    return (
      <Field label={label} error={errors[key]} hint={<span className={r < MIN_CONTRAST ? 'font-medium text-red-700' : ''}>{t('settings.contrast', { ratio: r.toFixed(2) })}</span>}>
        {(id) => (
          <div className="flex gap-2">
            <input type="color" aria-label={label} disabled={disabled} value={b[key]} onChange={(e) => setB({ ...b, [key]: e.target.value })} className="h-10 w-12 rounded border border-slate-300" />
            <Input id={id} disabled={disabled} value={b[key]} onChange={(e) => setB({ ...b, [key]: e.target.value })} />
          </div>
        )}
      </Field>
    );
  };

  return (
    <Card title={t('settings.branding')}>
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('settings.appName')} error={errors.appName}>
            {(id) => <Input id={id} disabled={disabled} value={b.appName} onChange={(e) => setB({ ...b, appName: e.target.value })} />}
          </Field>
          <Field label={t('settings.logoUrl')} error={errors.logoUrl}>
            {(id) => <Input id={id} disabled={disabled} type="url" placeholder="https://…" value={b.logoUrl ?? ''} onChange={(e) => setB({ ...b, logoUrl: e.target.value || null })} />}
          </Field>
          {colour('primaryColor', t('settings.primary'))}
          {colour('secondaryColor', t('settings.secondary'))}
          <Field label={t('settings.language')}>
            {(id) => (
              <Select id={id} disabled={disabled} value={b.locale} onChange={(e) => setB({ ...b, locale: e.target.value as Branding['locale'] })}>
                <option value="en">English (LTR)</option>
                <option value="fa">فارسی (RTL)</option>
              </Select>
            )}
          </Field>
        </div>
        <div aria-label={t('settings.preview')} className="overflow-hidden rounded-xl ring-1 ring-slate-200">
          <div className="bg-brand px-4 py-3 font-semibold text-white">{b.appName}</div>
          <div className="space-y-3 p-4 text-sm">
            <p>
              <span className="text-brand underline">Link</span> · <span className="text-brand-2 font-medium">Accent</span>
            </p>
            <button type="button" className="rounded-lg bg-brand px-3 py-1.5 text-white">
              Button
            </button>
          </div>
        </div>
      </div>
      {!disabled && (
        <div className="mt-5 flex items-center gap-3">
          <Button busy={save.isPending} onClick={() => save.mutate()}>
            {t('app.save')}
          </Button>
          {save.isSuccess && <span className="text-sm text-emerald-700">{t('app.saved')}</span>}
        </div>
      )}
      {save.error && !Object.keys(errors).length && <ErrorBox error={save.error} />}
    </Card>
  );
}

interface FeatureState {
  key: string;
  description: string;
  allowedByPlan: boolean;
  enabled: boolean;
}

function FeaturesCard() {
  const { t } = useI18n();
  const { can, reloadContext } = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['features'], queryFn: () => tenantApi.get<FeatureState[]>('/api/config/features') });
  const set = useMutation({
    mutationFn: (change: Record<string, boolean>) => tenantApi.put<FeatureState[]>('/api/config/features', change),
    onSuccess: (data) => {
      qc.setQueryData(['features'], data);
      void reloadContext(); // navigation follows the features
    },
  });
  return (
    <Card title={t('settings.features')}>
      <QueryState isLoading={q.isLoading} error={q.error}>
        <ul className="space-y-3">
          {q.data?.map((f) => (
            <li key={f.key} className="flex flex-wrap items-center justify-between gap-2">
              <Toggle
                checked={f.enabled}
                disabled={!f.allowedByPlan || !can('config:write') || set.isPending}
                onChange={(v) => set.mutate({ [f.key]: v })}
                label={
                  <span>
                    <code className="text-xs">{f.key}</code> <span className="text-slate-500">— {f.description}</span>
                  </span>
                }
              />
              {!f.allowedByPlan && <span className="text-xs text-slate-400">{t('settings.notInPlan')}</span>}
            </li>
          ))}
        </ul>
        {set.error && <ErrorBox error={set.error} />}
      </QueryState>
    </Card>
  );
}

interface PolicyResponse {
  override: EvaluationPolicyOverride;
  effective: EvaluationPolicy;
  planLimits: PlanPolicyLimits;
}

function PolicyCard() {
  const { t } = useI18n();
  const { can, reloadContext } = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['policy'], queryFn: () => tenantApi.get<PolicyResponse>('/api/config/evaluation-policy') });
  const [p, setP] = useState<EvaluationPolicy | null>(null);
  useEffect(() => {
    if (q.data) setP(q.data.effective);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => tenantApi.put<PolicyResponse>('/api/config/evaluation-policy', p!),
    onSuccess: (data) => {
      qc.setQueryData(['policy'], data);
      void reloadContext();
    },
  });
  const disabled = !can('config:write');
  return (
    <Card title={t('settings.policy')}>
      <QueryState isLoading={q.isLoading || !p} error={q.error}>
        {p && q.data && (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Field label={t('settings.cadence')}>
                {(id) => (
                  <Select id={id} disabled={disabled} value={p.cycle} onChange={(e) => setP({ ...p, cycle: e.target.value as EvaluationPolicy['cycle'] })}>
                    {CYCLE_CADENCES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('settings.scaleMax')}>
                {(id) => (
                  <Select id={id} disabled={disabled} value={p.scale.max} onChange={(e) => setP({ ...p, scale: { ...p.scale, max: Number(e.target.value) } })}>
                    {[3, 4, 5, 6, 7, 8, 9, 10]
                      .filter((n) => n <= q.data!.planLimits.maxScale)
                      .map((n) => (
                        <option key={n} value={n}>
                          {p.scale.min}–{n}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
              <Field label={t('settings.visibility')}>
                {(id) => (
                  <Select id={id} disabled={disabled} value={p.resultVisibility} onChange={(e) => setP({ ...p, resultVisibility: e.target.value as EvaluationPolicy['resultVisibility'] })}>
                    {RESULT_VISIBILITY.map((v) => (
                      <option key={v} value={v}>
                        {t(`settings.vis.${v}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <Toggle disabled={disabled} checked={p.selfAssessmentRequired} onChange={(v) => setP({ ...p, selfAssessmentRequired: v })} label={t('settings.selfRequired')} />
            <Toggle disabled={disabled} checked={p.approvalRequired} onChange={(v) => setP({ ...p, approvalRequired: v })} label={t('settings.approvalRequired')} />
            {p.approvalRequired && (
              <div className="max-w-xs">
                <Field label={t('settings.strategy')}>
                  {(id) => (
                    <Select id={id} disabled={disabled} value={p.approvalStrategy} onChange={(e) => setP({ ...p, approvalStrategy: e.target.value as EvaluationPolicy['approvalStrategy'] })}>
                      {APPROVAL_STRATEGIES.map((s) => (
                        <option key={s} value={s} disabled={!q.data!.planLimits.approvalStrategies.includes(s)}>
                          {t(`eval.strategy.${s}`)}
                          {!q.data!.planLimits.approvalStrategies.includes(s) ? ` (${t('settings.notInPlan')})` : ''}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            )}
            <p className="text-xs text-slate-500">{t('settings.policyNote')}</p>
            {!disabled && (
              <Button busy={save.isPending} onClick={() => save.mutate()}>
                {t('app.save')}
              </Button>
            )}
            {save.isSuccess && <span className="ms-3 text-sm text-emerald-700">{t('app.saved')}</span>}
            {save.error && <ErrorBox error={save.error} />}
          </div>
        )}
      </QueryState>
    </Card>
  );
}
