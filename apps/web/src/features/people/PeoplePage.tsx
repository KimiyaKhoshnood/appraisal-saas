import { useDeferredValue, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, Search, UserPlus } from 'lucide-react';
import type { Page as PageOf, RoleView, UserView } from '@appraisal/contracts';
import { useMe } from '../../app/tenant/session';
import { useI18n } from '../../shared/i18n/i18n';
import { ApiError, tenantApi } from '../../shared/lib/api';
import { cn } from '../../shared/lib/cn';
import { qk } from '../../shared/lib/query-keys';
import { Avatar, Badge, Button, Card, ErrorBox, Field, Input, Page, PageHeader, QueryState, Select, Table, Td, Tr, spring } from '../../shared/ui';

export default function PeoplePage() {
  const { t } = useI18n();
  const { can, me } = useMe();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const [adding, setAdding] = useState(false);
  const [passwordFor, setPasswordFor] = useState<string | null>(null);
  const users = useInfiniteQuery({
    queryKey: qk.users(deferred),
    queryFn: ({ pageParam }) =>
      tenantApi.get<PageOf<UserView>>(`/api/users?limit=50${deferred ? `&search=${encodeURIComponent(deferred)}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const roles = useQuery({ queryKey: qk.roles, queryFn: () => tenantApi.get<RoleView[]>('/api/roles'), enabled: can('role:read') });
  const rows = users.data?.pages.flatMap((p) => p.items) ?? [];
  const toggle = useMutation({
    mutationFn: (u: UserView) => tenantApi.post(`/api/users/${u.id}/${u.active ? 'deactivate' : 'activate'}`),
    onSuccess: () => {
      toast.success(t('app.saved'));
      void qc.invalidateQueries({ queryKey: qk.usersAll });
    },
  });

  return (
    <Page>
      <PageHeader
        title={t('nav.people')}
        actions={
          can('user:write') && (
            <Button icon={<UserPlus className="size-4" />} onClick={() => setAdding((a) => !a)}>
              {t('people.newUser')}
            </Button>
          )
        }
      />
      <AnimatePresence>{adding && can('user:write') && <NewUser roles={roles.data ?? []} onDone={() => setAdding(false)} />}</AnimatePresence>
      <Card
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input aria-label="Search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-60 ps-8" />
          </div>
        }
        title={t('nav.people')}
      >
        <QueryState isLoading={users.isLoading} error={users.error} isEmpty={!rows.length} onRetry={() => void users.refetch()}>
          <Table head={[t('people.fullName'), t('people.roles'), t('app.status'), '']}>
            {rows.map((u) => (
              <Tr key={u.id}>
                <Td>
                  <div className="flex items-center gap-3">
                    <Avatar name={u.fullName} size="sm" />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-fg">{u.fullName}</div>
                      <div className="flex items-center gap-2 truncate text-xs text-muted">
                        {u.email}
                        {!u.hasPassword && (
                          <span title={t('people.noPasswordHint')}>
                            <Badge tone="MANAGER_SUBMITTED">{t('people.noPassword')}</Badge>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Td>
                <Td>
                  {can('role:write') && roles.data ? (
                    <RolePicker user={u} roles={roles.data} />
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <Badge key={r.id} tone="BRAND">
                          {r.name}
                        </Badge>
                      ))}
                    </div>
                  )}
                </Td>
                <Td>{u.active ? <Badge tone="ACTIVE" dot>{t('status.ACTIVE')}</Badge> : <Badge tone="SUSPENDED" dot>{t('people.inactive')}</Badge>}</Td>
                <Td className="text-end">
                  {can('user:write') && u.id !== me.user.id && (
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" icon={<KeyRound className="size-3.5" />} onClick={() => setPasswordFor((id) => (id === u.id ? null : u.id))}>
                        {t('people.setPassword')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => toggle.mutate(u)}>
                        {u.active ? t('people.deactivate') : t('people.activate')}
                      </Button>
                    </div>
                  )}
                  <AnimatePresence>{passwordFor === u.id && <SetPassword user={u} onDone={() => setPasswordFor(null)} />}</AnimatePresence>
                </Td>
              </Tr>
            ))}
          </Table>
          {users.hasNextPage && (
            <Button variant="secondary" className="mt-4" onClick={() => void users.fetchNextPage()}>
              {t('audit.loadMore')}
            </Button>
          )}
        </QueryState>
        {toggle.error && (
          <div className="mt-4">
            <ErrorBox error={toggle.error} />
          </div>
        )}
      </Card>
    </Page>
  );
}

function RolePicker({ user, roles }: { user: UserView; roles: RoleView[] }) {
  const qc = useQueryClient();
  const set = useMutation({
    mutationFn: (roleIds: string[]) => tenantApi.put<UserView>(`/api/users/${user.id}/roles`, { roleIds }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.usersAll });
      void qc.invalidateQueries({ queryKey: qk.roles });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : String(err)),
  });
  const current = new Set(user.roles.map((r) => r.id));
  return (
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
            className={cn(
              'focus-ring relative rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 transition-colors disabled:opacity-60',
              on ? 'text-white ring-transparent' : 'text-muted ring-line hover:text-fg',
            )}
          >
            {on && <motion.span layoutId={`role-${user.id}-${r.id}`} transition={spring} className="absolute inset-0 rounded-full bg-brand" />}
            <span className="relative">{r.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function NewUser({ roles, onDone }: { roles: RoleView[]; onDone: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', roleId: '' });
  const create = useMutation({
    mutationFn: () => tenantApi.post('/api/users', { fullName: form.fullName, email: form.email, password: form.password, roleIds: form.roleId ? [form.roleId] : [] }),
    onSuccess: () => {
      toast.success(t('app.saved'));
      void qc.invalidateQueries({ queryKey: qk.usersAll });
      onDone();
    },
  });
  const errors = create.error instanceof ApiError ? create.error.fieldErrors : {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
      <Card title={t('people.newUser')} icon={<UserPlus className="size-4" />}>
        <form onSubmit={submit} className="grid items-start gap-4 md:grid-cols-4">
          <Field label={t('people.fullName')} error={errors.fullName}>
            {(id, invalid) => <Input id={id} aria-invalid={invalid} required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />}
          </Field>
          <Field label={t('app.email')} error={errors.email}>
            {(id, invalid) => <Input id={id} aria-invalid={invalid} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
          </Field>
          <Field label={t('people.initialPassword')} error={errors.password}>
            {(id, invalid) => (
              <Input id={id} aria-invalid={invalid} type="password" required minLength={10} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            )}
          </Field>
          <Field label={t('people.roles')}>
            {(id) => (
              <Select id={id} value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
                <option value="">{roles.find((r) => r.systemKey === 'EMPLOYEE')?.name ?? 'Employee'}</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="flex gap-2 md:col-span-4">
            <Button type="submit" busy={create.isPending}>
              {t('app.create')}
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>
              {t('app.cancel')}
            </Button>
          </div>
        </form>
        {create.error && !Object.keys(errors).length && (
          <div className="mt-4">
            <ErrorBox error={create.error} />
          </div>
        )}
      </Card>
    </motion.div>
  );
}

/** An administrator sets a temporary password (e.g. for users restored from an export, ADR-016). */
function SetPassword({ user, onDone }: { user: UserView; onDone: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const save = useMutation({
    mutationFn: () => tenantApi.post<UserView>(`/api/users/${user.id}/password`, { password }),
    onSuccess: () => {
      toast.success(t('people.passwordSet'));
      void qc.invalidateQueries({ queryKey: qk.usersAll });
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <motion.form
      onSubmit={submit}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="mt-2 flex items-center justify-end gap-2 overflow-hidden"
    >
      <Input
        aria-label={t('people.newPassword')}
        placeholder={t('people.newPassword')}
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="h-8 w-56 text-xs"
      />
      <Button size="sm" type="submit" busy={save.isPending}>
        {t('app.save')}
      </Button>
      {save.error && <span className="text-xs text-red-600 dark:text-red-400">{save.error.message}</span>}
    </motion.form>
  );
}
