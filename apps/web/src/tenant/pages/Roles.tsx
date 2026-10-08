import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Permission, RoleView } from '@appraisal/contracts';
import { Badge, Button, Card, ErrorBox, Input, PageHeader, QueryState } from '../../components/ui';
import { useI18n } from '../../i18n/i18n';
import { tenantApi } from '../../lib/api';
import { useMe } from '../session';

/** Roles are data (TA-08): a custom role is a name plus permissions from the code catalog. */
export default function RolesPage() {
  const { t, formatNumber } = useI18n();
  const { can, has } = useMe();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => tenantApi.get<RoleView[]>('/api/roles') });
  const catalog = useQuery({ queryKey: ['permissions'], queryFn: () => tenantApi.get<{ key: Permission; description: string }[]>('/api/permissions') });
  const editable = can('role:write') && has('customRoles');

  return (
    <>
      <PageHeader title={t('nav.roles')} subtitle={!has('customRoles') ? t('roles.customOff') : undefined} />
      {editable && catalog.data && <RoleEditor catalog={catalog.data} />}
      <QueryState isLoading={roles.isLoading} error={roles.error} onRetry={() => void roles.refetch()}>
        <div className="grid gap-4 md:grid-cols-2">
          {roles.data?.map((r) => (
            <Card
              key={r.id}
              title={
                <span className="flex items-center gap-2">
                  {r.name}
                  <Badge tone={r.systemKey ? 'DRAFT' : 'CHANGE'}>{r.systemKey ? t('roles.system') : t('roles.custom')}</Badge>
                </span>
              }
              actions={<span className="text-xs text-slate-500">{t('roles.users', { n: formatNumber(r.userCount) })}</span>}
            >
              <div className="flex flex-wrap gap-1">
                {r.permissions.map((p) => (
                  <code key={p} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                    {p}
                  </code>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </QueryState>
    </>
  );
}

function RoleEditor({ catalog }: { catalog: { key: Permission; description: string }[] }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<Permission>>(new Set());
  const create = useMutation({
    mutationFn: () => tenantApi.post('/api/roles', { name, permissions: [...selected] }),
    onSuccess: () => {
      setName('');
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['roles'] });
    },
  });
  return (
    <Card title={t('roles.new')} className="mb-6">
      <div className="space-y-4">
        <Input aria-label={t('app.name')} placeholder={t('app.name')} value={name} onChange={(e) => setName(e.target.value)} className="max-w-sm" />
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t('roles.permissions')}</legend>
          <div className="grid gap-2 md:grid-cols-2">
            {catalog.map((p) => (
              <label key={p.key} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--brand)]"
                  checked={selected.has(p.key)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(p.key);
                    else next.delete(p.key);
                    setSelected(next);
                  }}
                />
                <span>
                  <code className="text-xs">{p.key}</code>
                  <span className="block text-xs text-slate-500">{p.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Button busy={create.isPending} disabled={name.trim().length < 2 || !selected.size} onClick={() => create.mutate()}>
          {t('app.create')}
        </Button>
        {create.error && <ErrorBox error={create.error} />}
      </div>
    </Card>
  );
}
