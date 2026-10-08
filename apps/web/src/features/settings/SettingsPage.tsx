import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Palette, SlidersHorizontal, ToggleLeft } from 'lucide-react';
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
import { useMe } from '../../app/tenant/session';
import { useI18n } from '../../shared/i18n/i18n';
import { ApiError, tenantApi } from '../../shared/lib/api';
import { qk } from '../../shared/lib/query-keys';
import { applyBranding } from '../../shared/lib/theme';
import { Badge, Button, Card, ErrorBox, Field, Input, Page, PageHeader, QueryState, Segmented, Select, SkeletonRows, Toggle } from '../../shared/ui';

export default function SettingsPage() {
  const { t } = useI18n();
  return (
    <Page>
      <PageHeader title={t('nav.settings')} />
      <BrandingCard />
      <div className="grid gap-6 xl:grid-cols-2">
        <FeaturesCard />
        <PolicyCard />
      </div>
    </Page>
  );
}

function ContrastMeter({ ratio }: { ratio: number }) {
  const ok = ratio >= MIN_CONTRAST;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2">
        <motion.div className={ok ? 'h-full bg-emerald-500' : 'h-full bg-red-500'} animate={{ width: `${Math.min(100, (ratio / 7) * 100)}%` }} />
      </div>
      <span className={ok ? 'text-xs text-emerald-600 dark:text-emerald-400' : 'text-xs font-medium text-red-600 dark:text-red-400'}>{ratio.toFixed(2)}:1</span>
    </div>
  );
}

function BrandingCard() {
  const { t } = useI18n();
  const { can, me, reloadContext } = useMe();
  const [b, setB] = useState<Branding>(me.branding);
  useEffect(() => setB(me.branding), [me.branding]);
  // Live preview: the whole product re-themes while editing; leaving the page restores it.
  useEffect(() => {
    applyBranding(b);
    return () => applyBranding(me.branding);
  }, [b, me.branding]);
  const save = useMutation({
    mutationFn: () => tenantApi.put<Branding>('/api/config/branding', b),
    onSuccess: () => {
      toast.success(t('app.saved'));
      void reloadContext();
    },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};
  const ratio = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? contrastRatio(c, '#ffffff') : 0);
  const disabled = !can('config:write');

  const colour = (key: 'primaryColor' | 'secondaryColor', label: string) => (
    <Field label={label} error={errors[key]} hint={<ContrastMeter ratio={ratio(b[key])} />}>
      {(id, invalid) => (
        <div className="flex gap-2">
          <label className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-lg ring-1 ring-line" style={{ background: b[key] }}>
            <input type="color" aria-label={label} disabled={disabled} value={b[key]} onChange={(e) => setB({ ...b, [key]: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" />
          </label>
          <Input id={id} aria-invalid={invalid} disabled={disabled} value={b[key]} onChange={(e) => setB({ ...b, [key]: e.target.value })} className="font-mono" />
        </div>
      )}
    </Field>
  );

  return (
    <Card title={t('settings.branding')} icon={<Palette className="size-4" />}>
      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label={t('settings.appName')} error={errors.appName}>
            {(id, invalid) => <Input id={id} aria-invalid={invalid} disabled={disabled} value={b.appName} onChange={(e) => setB({ ...b, appName: e.target.value })} />}
          </Field>
          <Field label={t('settings.logoUrl')} error={errors.logoUrl}>
            {(id, invalid) => <Input id={id} aria-invalid={invalid} disabled={disabled} type="url" placeholder="https://…" value={b.logoUrl ?? ''} onChange={(e) => setB({ ...b, logoUrl: e.target.value || null })} />}
          </Field>
          {colour('primaryColor', t('settings.primary'))}
          {colour('secondaryColor', t('settings.secondary'))}
          <Field label={t('settings.language')}>
            {() => (
              <Segmented
                id="locale"
                value={b.locale}
                onChange={(locale) => !disabled && setB({ ...b, locale })}
                options={[
                  { value: 'en', label: 'English · LTR' },
                  { value: 'fa', label: 'فارسی · RTL' },
                ]}
              />
            )}
          </Field>
        </div>
        <motion.div layout aria-label={t('settings.preview')} className="overflow-hidden rounded-2xl border border-line bg-bg shadow-card">
          <div className="flex items-center gap-2 bg-gradient-to-r from-brand to-brand-2 px-4 py-3 text-white">
            <span className="grid size-7 place-items-center rounded-lg bg-white/20 text-xs font-bold">{b.appName.slice(0, 1)}</span>
            <span className="text-sm font-semibold">{b.appName}</span>
          </div>
          <div className="space-y-3 p-4 text-sm">
            <div className="flex gap-2">
              <Badge tone="BRAND">Badge</Badge>
              <Badge tone="PUBLISHED" dot>
                {t('status.PUBLISHED')}
              </Badge>
            </div>
            <p className="text-muted">
              <span className="font-medium text-brand-text underline">Link</span> · <span className="font-medium text-brand-2">Accent</span>
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <motion.div className="h-full rounded-full bg-brand" initial={{ width: '20%' }} animate={{ width: '72%' }} transition={{ duration: 1.2 }} />
            </div>
            <Button size="sm">Button</Button>
          </div>
        </motion.div>
      </div>
      {!disabled && (
        <div className="mt-6 flex items-center gap-3 border-t border-line pt-5">
          <Button busy={save.isPending} onClick={() => save.mutate()}>
            {t('app.save')}
          </Button>
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
  const q = useQuery({ queryKey: qk.features, queryFn: () => tenantApi.get<FeatureState[]>('/api/config/features') });
  const set = useMutation({
    mutationFn: (change: Record<string, boolean>) => tenantApi.put<FeatureState[]>('/api/config/features', change),
    onSuccess: (data) => {
      qc.setQueryData(qk.features, data);
      toast.success(t('app.saved'));
      void reloadContext(); // navigation follows the features
    },
  });
  return (
    <Card title={t('settings.features')} icon={<ToggleLeft className="size-4" />}>
      <QueryState isLoading={q.isLoading} error={q.error} skeleton={<SkeletonRows rows={4} cols={2} />}>
        <ul className="divide-y divide-line">
          {q.data?.map((f) => (
            <li key={f.key} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <Toggle
                checked={f.enabled}
                disabled={!f.allowedByPlan || !can('config:write') || set.isPending}
                onChange={(v) => set.mutate({ [f.key]: v })}
                label={
                  <span>
                    <span className="font-medium">{f.key}</span>
                    <span className="block text-xs text-muted">{f.description}</span>
                  </span>
                }
              />
              {!f.allowedByPlan && <Badge>{t('settings.notInPlan')}</Badge>}
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
  const q = useQuery({ queryKey: qk.policy, queryFn: () => tenantApi.get<PolicyResponse>('/api/config/evaluation-policy') });
  const [p, setP] = useState<EvaluationPolicy | null>(null);
  useEffect(() => {
    if (q.data) setP(q.data.effective);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => tenantApi.put<PolicyResponse>('/api/config/evaluation-policy', p!),
    onSuccess: (data) => {
      qc.setQueryData(qk.policy, data);
      toast.success(t('app.saved'));
      void reloadContext();
    },
  });
  const disabled = !can('config:write');
  return (
    <Card title={t('settings.policy')} description={t('settings.policyNote')} icon={<SlidersHorizontal className="size-4" />}>
      <QueryState isLoading={q.isLoading || !p} error={q.error} skeleton={<SkeletonRows rows={4} cols={2} />}>
        {p && q.data && (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
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
            </div>
            <Field label={t('settings.visibility')}>
              {() => (
                <Segmented id="vis" value={p.resultVisibility} onChange={(v) => !disabled && setP({ ...p, resultVisibility: v })} options={RESULT_VISIBILITY.map((v) => ({ value: v, label: t(`settings.vis.${v}`) }))} />
              )}
            </Field>
            <div className="space-y-3 rounded-xl bg-surface-2/60 p-4">
              <Toggle disabled={disabled} checked={p.selfAssessmentRequired} onChange={(v) => setP({ ...p, selfAssessmentRequired: v })} label={t('settings.selfRequired')} />
              <Toggle disabled={disabled} checked={p.approvalRequired} onChange={(v) => setP({ ...p, approvalRequired: v })} label={t('settings.approvalRequired')} />
              <motion.div initial={false} animate={{ height: p.approvalRequired ? 'auto' : 0, opacity: p.approvalRequired ? 1 : 0 }} className="overflow-hidden">
                <div className="pt-2">
                  <Segmented
                    id="strategy"
                    value={p.approvalStrategy}
                    onChange={(s) => !disabled && q.data!.planLimits.approvalStrategies.includes(s) && setP({ ...p, approvalStrategy: s })}
                    options={APPROVAL_STRATEGIES.map((s) => ({
                      value: s,
                      label: `${t(`eval.strategy.${s}`)}${q.data!.planLimits.approvalStrategies.includes(s) ? '' : ` · ${t('settings.notInPlan')}`}`,
                    }))}
                  />
                </div>
              </motion.div>
            </div>
            {!disabled && (
              <Button busy={save.isPending} onClick={() => save.mutate()}>
                {t('app.save')}
              </Button>
            )}
            {save.error && <ErrorBox error={save.error} />}
          </div>
        )}
      </QueryState>
    </Card>
  );
}
