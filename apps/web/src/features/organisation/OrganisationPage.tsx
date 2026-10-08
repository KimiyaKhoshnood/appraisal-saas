import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, Network, Plus } from 'lucide-react';
import type { DepartmentView, EmployeeView } from '@appraisal/contracts';
import { useMe } from '../../app/tenant/session';
import { useI18n } from '../../shared/i18n/i18n';
import { ApiError, tenantApi } from '../../shared/lib/api';
import { qk } from '../../shared/lib/query-keys';
import { Avatar, Button, Card, ErrorBox, Input, Page, PageHeader, QueryState, Select, SkeletonRows, Table, Td, Tr } from '../../shared/ui';

/** TA-03: departments and reporting lines (who is whose direct manager). */
export default function OrganisationPage() {
  const { t, formatNumber } = useI18n();
  const { can } = useMe();
  const qc = useQueryClient();
  const writable = can('org:write');
  const depts = useQuery({ queryKey: qk.departments, queryFn: () => tenantApi.get<DepartmentView[]>('/api/org/departments') });
  const people = useQuery({ queryKey: qk.employees, queryFn: () => tenantApi.get<EmployeeView[]>('/api/org/employees') });
  const [name, setName] = useState('');
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.employees });
    void qc.invalidateQueries({ queryKey: qk.departments });
  };
  const createDept = useMutation({
    mutationFn: () => tenantApi.post('/api/org/departments', { name }),
    onSuccess: () => {
      setName('');
      toast.success(t('app.saved'));
      refresh();
    },
  });
  const update = useMutation({
    mutationFn: ({ userId, patch }: { userId: string; patch: Record<string, string | null> }) => tenantApi.put(`/api/org/employees/${userId}`, patch),
    onSuccess: () => {
      toast.success(t('app.saved'));
      refresh();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : String(err)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    createDept.mutate();
  };
  const maxCount = Math.max(1, ...(depts.data?.map((d) => d.employeeCount) ?? [1]));

  return (
    <Page>
      <PageHeader title={t('nav.organisation')} />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card title={t('org.departments')} icon={<Building2 className="size-4" />}>
          <QueryState isLoading={depts.isLoading} error={depts.error} isEmpty={!depts.data?.length} skeleton={<SkeletonRows rows={3} cols={2} />}>
            <ul className="mb-5 space-y-3">
              {depts.data?.map((d, i) => (
                <li key={d.id} className="text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium text-fg">{d.name}</span>
                    <span className="text-muted tabular">{t('org.employees', { n: formatNumber(d.employeeCount) })}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <motion.div className="h-full rounded-full bg-brand" initial={{ width: 0 }} animate={{ width: `${(d.employeeCount / maxCount) * 100}%` }} transition={{ delay: i * 0.06, duration: 0.6 }} />
                  </div>
                </li>
              ))}
            </ul>
          </QueryState>
          {writable && (
            <form onSubmit={submit} className="flex gap-2">
              <Input aria-label={t('org.newDepartment')} placeholder={t('org.newDepartment')} required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
              <Button type="submit" busy={createDept.isPending} icon={<Plus className="size-4" />} aria-label={t('app.create')} />
            </form>
          )}
          {createDept.error && (
            <div className="mt-3">
              <ErrorBox error={createDept.error} />
            </div>
          )}
        </Card>
        <Card title={t('people.reportsTo')} icon={<Network className="size-4" />}>
          <QueryState isLoading={people.isLoading} error={people.error} isEmpty={!people.data?.length}>
            <Table head={[t('people.fullName'), t('people.department'), t('people.reportsTo')]}>
              {people.data?.map((p) => (
                <Tr key={p.userId}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={p.fullName} size="sm" />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-fg">{p.fullName}</div>
                        <div className="truncate text-xs text-muted">{p.jobTitle ?? '—'}</div>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    {writable ? (
                      <Select aria-label={`${t('people.department')}: ${p.fullName}`} value={p.department?.id ?? ''} onChange={(e) => update.mutate({ userId: p.userId, patch: { departmentId: e.target.value || null } })}>
                        <option value="">{t('people.none')}</option>
                        {depts.data?.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      (p.department?.name ?? '—')
                    )}
                  </Td>
                  <Td>
                    {writable ? (
                      <Select aria-label={`${t('people.reportsTo')}: ${p.fullName}`} value={p.manager?.id ?? ''} onChange={(e) => update.mutate({ userId: p.userId, patch: { managerId: e.target.value || null } })}>
                        <option value="">{t('people.none')}</option>
                        {people.data
                          ?.filter((m) => m.userId !== p.userId)
                          .map((m) => (
                            <option key={m.userId} value={m.userId}>
                              {m.fullName}
                            </option>
                          ))}
                      </Select>
                    ) : (
                      (p.manager?.fullName ?? '—')
                    )}
                  </Td>
                </Tr>
              ))}
            </Table>
          </QueryState>
        </Card>
      </div>
    </Page>
  );
}
