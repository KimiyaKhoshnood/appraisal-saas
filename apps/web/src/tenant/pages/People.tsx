import { useState, type FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Page, RoleView, UserView } from '@appraisal/contracts';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, QueryState, Table, Td } from '../../components/ui';
import { useI18n } from '../../i18n/i18n';
import { ApiError, tenantApi } from '../../lib/api';
import { useMe } from '../session';

export default function PeoplePage() {
  const { t } = useI18n();
  const { can, me } = useMe();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const users = useInfiniteQuery({
    queryKey: ['users', search],
    queryFn: ({ pageParam }) =>
      tenantApi.get<Page<UserView>>(`/api/users?limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => tenantApi.get<RoleView[]>('/api/roles'), enabled: can('role:read') });
  const rows = users.data?.pages.flatMap((p) => p.items) ?? [];
  const toggle = useMutation({
    mutationFn: (u: UserView) => tenantApi.post(`/api/users/${u.id}/${u.active ? 'deactivate' : 'activate'}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <>
      <PageHeader title={t('nav.people')} />
      {can('user:write') && <NewUser roles={roles.data ?? []} />}
      <Card actions={<Input aria-label="Search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />}>
        <QueryState isLoading={users.isLoading} error={users.error} isEmpty={!rows.length} onRetry={() => void users.refetch()}>
          <Table head={[t('people.fullName'), t('app.email'), t('people.roles'), t('app.status'), '']}>
            {rows.map((u) => (
              <tr key={u.id}>
                <Td className="font-medium">{u.fullName}</Td>
                <Td>{u.email}</Td>
                <Td>
                  {can('role:write') && roles.data ? (
                    <RolePicker user={u} roles={roles.data} />
                  ) : (
                    <div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r.id} tone="CHANGE">{r.name}</Badge>)}</div>
                  )}
                </Td>
                <Td>{u.active ? <Badge tone="ACTIVE">{t('status.ACTIVE')}</Badge> : <Badge tone="SUSPENDED">{t('people.inactive')}</Badge>}</Td>
                <Td className="text-end">
                  {can('user:write') && u.id !== me.user.id && (
                    <Button variant="ghost" onClick={() => toggle.mutate(u)}>
                      {u.active ? t('people.deactivate') : t('people.activate')}
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
          {users.hasNextPage && (
            <Button variant="secondary" className="mt-4" onClick={() => void users.fetchNextPage()}>
              {t('audit.loadMore')}
            </Button>
          )}
        </QueryState>
        {toggle.error && <ErrorBox error={toggle.error} />}
      </Card>
    </>
  );
}

function RolePicker({ user, roles }: { user: UserView; roles: RoleView[] }) {
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const set = useMutation({
    mutationFn: (roleIds: string[]) => tenantApi.put<UserView>(`/api/users/${user.id}/roles`, { roleIds }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: setError,
  });
  const current = new Set(user.roles.map((r) => r.id));
  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {roles.map((r) => {
          const on = current.has(r.id);
          return (
            <button
              key={r.id}
              type="button"
              aria-pressed={on}
              disabled={set.isPending || (on && current.size === 1)}
              onClick={() => set.mutate(on ? [...current].filter((x) => x !== r.id) : [...current, r.id])}
              className={`focus-ring rounded-full px-2.5 py-0.5 text-xs ring-1 ${on ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'}`}
            >
              {r.name}
            </button>
          );
        })}
      </div>
      {error instanceof ApiError && <p className="mt-1 text-xs text-red-700">{error.message}</p>}
    </div>
  );
}

function NewUser({ roles }: { roles: RoleView[] }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', roleId: '' });
  const create = useMutation({
    mutationFn: () =>
      tenantApi.post('/api/users', {
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        roleIds: form.roleId ? [form.roleId] : [],
      }),
    onSuccess: () => {
      setForm({ fullName: '', email: '', password: '', roleId: '' });
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
  const errors = create.error instanceof ApiError ? create.error.fieldErrors : {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <Card title={t('people.newUser')} className="mb-6">
      <form onSubmit={submit} className="grid items-start gap-4 md:grid-cols-4">
        <Field label={t('people.fullName')} error={errors.fullName}>
          {(id) => <Input id={id} required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />}
        </Field>
        <Field label={t('app.email')} error={errors.email}>
          {(id) => <Input id={id} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
        </Field>
        <Field label={t('people.initialPassword')} error={errors.password}>
          {(id) => <Input id={id} type="password" required minLength={10} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
        </Field>
        <Field label={t('people.roles')}>
          {(id) => (
            <select id={id} className="focus-ring block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
              <option value="">{roles.find((r) => r.systemKey === 'EMPLOYEE')?.name ?? 'Employee'}</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="md:col-span-4">
          <Button type="submit" busy={create.isPending}>
            {t('app.create')}
          </Button>
        </div>
      </form>
      {create.error && !Object.keys(errors).length && (
        <div className="mt-4">
          <ErrorBox error={create.error} />
        </div>
      )}
    </Card>
  );
}
