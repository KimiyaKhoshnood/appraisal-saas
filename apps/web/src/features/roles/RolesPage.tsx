import { useState } from 'react';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, Lock, Plus, ShieldCheck } from 'lucide-react';
import type { Permission, RoleView } from '@appraisal/contracts';
import { useMe } from '../../app/tenant/session';
import { useI18n } from '../../shared/i18n/i18n';
import { tenantApi } from '../../shared/lib/api';
import { cn } from '../../shared/lib/cn';
import { qk } from '../../shared/lib/query-keys';
import { Badge, Button, Card, ErrorBox, Input, Page, PageHeader, QueryState, SkeletonCards, fadeUp } from '../../shared/ui';

/** Roles are data (TA-08): a custom role is a name plus permissions from the code catalog. */
export default function RolesPage() {
  const { t, formatNumber } = useI18n();
  const { can, has } = useMe();
  const roles = useQuery({ queryKey: qk.roles, queryFn: () => tenantApi.get<RoleView[]>('/api/roles') });
  const catalog = useQuery({ queryKey: qk.permissions, queryFn: () => tenantApi.get<{ key: Permission; description: string }[]>('/api/permissions') });
  const editable = can('role:write') && has('customRoles');

  return (
    <Page>
      <PageHeader title={t('nav.roles')} subtitle={!has('customRoles') ? t('roles.customOff') : undefined} />
      {editable && catalog.data && <RoleEditor catalog={catalog.data} />}
      <QueryState isLoading={roles.isLoading} error={roles.error} onRetry={() => void roles.refetch()} skeleton={<SkeletonCards count={3} />}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roles.data?.map((r) => (
            <motion.div key={r.id} variants={fadeUp} whileHover={{ y: -3 }} className="rounded-2xl border border-line bg-surface p-5 shadow-card">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-xl bg-brand-soft text-brand-text">{r.systemKey ? <Lock className="size-4" /> : <ShieldCheck className="size-4" />}</span>
                  <div>
                    <div className="font-semibold text-fg">{r.name}</div>
                    <div className="text-xs text-muted">{t('roles.users', { n: formatNumber(r.userCount) })}</div>
                  </div>
                </div>
                <Badge tone={r.systemKey ? 'NEUTRAL' : 'CHANGE'}>{r.systemKey ? t('roles.system') : t('roles.custom')}</Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-1">
                {r.permissions.map((p) => (
                  <code key={p} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
                    {p}
                  </code>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </QueryState>
    </Page>
  );
}

function RoleEditor({ catalog }: { catalog: { key: Permission; description: string }[] }) {
  const { t } = useI18n();
  const { me } = useMe();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<Permission>>(new Set());
  const create = useMutation({
    mutationFn: () => tenantApi.post('/api/roles', { name, permissions: [...selected] }),
    onSuccess: () => {
      setName('');
      setSelected(new Set());
      toast.success(t('app.saved'));
      void qc.invalidateQueries({ queryKey: qk.roles });
    },
  });
  // The grant ceiling is enforced by the server; the UI simply does not offer what you lack.
  const grantable = (p: Permission) => me.permissions.includes(p);

  return (
    <Card title={t('roles.new')} icon={<KeyRound className="size-4" />}>
      <div className="space-y-5">
        <Input aria-label={t('app.name')} placeholder={t('app.name')} value={name} onChange={(e) => setName(e.target.value)} className="max-w-sm" />
        <fieldset>
          <legend className="mb-3 text-xs font-medium text-muted">{t('roles.permissions')}</legend>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {catalog.map((p) => {
              const on = selected.has(p.key);
              return (
                <label
                  key={p.key}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                    on ? 'border-brand bg-brand-softer' : 'border-line hover:border-zinc-400/60',
                    !grantable(p.key) && 'pointer-events-none opacity-40',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-[var(--brand)]"
                    checked={on}
                    disabled={!grantable(p.key)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(p.key);
                      else next.delete(p.key);
                      setSelected(next);
                    }}
                  />
                  <span>
                    <code className="text-xs text-fg">{p.key}</code>
                    <span className="block text-xs text-muted">{p.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <Button busy={create.isPending} disabled={name.trim().length < 2 || !selected.size} onClick={() => create.mutate()} icon={<Plus className="size-4" />}>
          {t('app.create')}
        </Button>
        {create.error && <ErrorBox error={create.error} />}
      </div>
    </Card>
  );
}
