import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DepartmentView, EmployeeView } from '@appraisal/contracts';
import { Button, Card, ErrorBox, Input, PageHeader, QueryState, Select, Table, Td } from '../../components/ui';
import { useI18n } from '../../i18n/i18n';
import { tenantApi } from '../../lib/api';
import { useMe } from '../session';

/** TA-03: departments and reporting lines (who is whose direct manager). */
export default function OrganisationPage() {
  const { t, formatNumber } = useI18n();
  const { can } = useMe();
  const qc = useQueryClient();
  const writable = can('org:write');
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => tenantApi.get<DepartmentView[]>('/api/org/departments') });
  const people = useQuery({ queryKey: ['employees'], queryFn: () => tenantApi.get<EmployeeView[]>('/api/org/employees') });
  const [name, setName] = useState('');
  const createDept = useMutation({
    mutationFn: () => tenantApi.post('/api/org/departments', { name }),
    onSuccess: () => {
      setName('');
      void qc.invalidateQueries({ queryKey: ['departments'] });
    },
  });
  const update = useMutation({
    mutationFn: ({ userId, patch }: { userId: string; patch: Record<string, string | null> }) => tenantApi.put(`/api/org/employees/${userId}`, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employees'] });
      void qc.invalidateQueries({ queryKey: ['departments'] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    createDept.mutate();
  };

  return (
    <>
      <PageHeader title={t('nav.organisation')} />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card title={t('org.departments')}>
          <QueryState isLoading={depts.isLoading} error={depts.error} isEmpty={!depts.data?.length}>
            <ul className="mb-4 divide-y divide-slate-100">
              {depts.data?.map((d) => (
                <li key={d.id} className="flex justify-between py-2 text-sm">
                  <span className="font-medium">{d.name}</span>
                  <span className="text-slate-500">{t('org.employees', { n: formatNumber(d.employeeCount) })}</span>
                </li>
              ))}
            </ul>
          </QueryState>
          {writable && (
            <form onSubmit={submit} className="flex gap-2">
              <Input aria-label={t('org.newDepartment')} placeholder={t('org.newDepartment')} required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
              <Button type="submit" busy={createDept.isPending}>
                {t('app.create')}
              </Button>
            </form>
          )}
          {createDept.error && <ErrorBox error={createDept.error} />}
        </Card>
        <Card>
          <QueryState isLoading={people.isLoading} error={people.error} isEmpty={!people.data?.length}>
            <Table head={[t('people.fullName'), t('people.jobTitle'), t('people.department'), t('people.reportsTo')]}>
              {people.data?.map((p) => (
                <tr key={p.userId}>
                  <Td className="font-medium">{p.fullName}</Td>
                  <Td>{p.jobTitle ?? '—'}</Td>
                  <Td>
                    {writable ? (
                      <Select
                        aria-label={`${t('people.department')}: ${p.fullName}`}
                        value={p.department?.id ?? ''}
                        onChange={(e) => update.mutate({ userId: p.userId, patch: { departmentId: e.target.value || null } })}
                      >
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
                      <Select
                        aria-label={`${t('people.reportsTo')}: ${p.fullName}`}
                        value={p.manager?.id ?? ''}
                        onChange={(e) => update.mutate({ userId: p.userId, patch: { managerId: e.target.value || null } })}
                      >
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
                </tr>
              ))}
            </Table>
          </QueryState>
          {update.error && (
            <div className="mt-4">
              <ErrorBox error={update.error} />
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
