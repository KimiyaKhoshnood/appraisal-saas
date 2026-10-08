import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EvaluationDetailView, EvaluationSummaryView, Page, SaveScoresInput } from '@appraisal/contracts';
import { tenantApi } from '../../shared/lib/api';
import { qk } from '../../shared/lib/query-keys';

export type EvaluationScope = 'mine' | 'team' | 'approvals' | 'all';

export function useEvaluations(scope: EvaluationScope, limit = 50, enabled = true) {
  return useInfiniteQuery({
    enabled,
    queryKey: [...qk.evaluations.list(scope), limit],
    queryFn: ({ pageParam }) =>
      tenantApi.get<Page<EvaluationSummaryView>>(`/api/evaluations?scope=${scope}&limit=${limit}${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useEvaluation(id: string) {
  return useQuery({ queryKey: qk.evaluations.detail(id), queryFn: () => tenantApi.get<EvaluationDetailView>(`/api/evaluations/${id}`) });
}

type Action =
  | { kind: 'save'; evaluator: 'SELF' | 'MANAGER'; body: SaveScoresInput }
  | { kind: 'submit'; evaluator: 'SELF' | 'MANAGER'; body: SaveScoresInput }
  | { kind: 'approve'; comment?: string }
  | { kind: 'reject'; reason: string };

/** Every transition of the state machine; the server re-validates each against the cycle's policy. */
export function useEvaluationAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: Action) => {
      const base = `/api/evaluations/${id}`;
      const who = 'evaluator' in a ? (a.evaluator === 'SELF' ? 'self' : 'manager') : '';
      switch (a.kind) {
        case 'save':
          return tenantApi.put<EvaluationDetailView>(`${base}/${who}-scores`, a.body);
        case 'submit':
          return tenantApi.post<EvaluationDetailView>(`${base}/${who}-submit`, a.body);
        case 'approve':
          return tenantApi.post<EvaluationDetailView>(`${base}/approve`, a.comment ? { comment: a.comment } : {});
        case 'reject':
          return tenantApi.post<EvaluationDetailView>(`${base}/reject`, { reason: a.reason });
      }
    },
    onSuccess: (data) => {
      qc.setQueryData(qk.evaluations.detail(id), data);
      void qc.invalidateQueries({ queryKey: qk.evaluations.all });
      void qc.invalidateQueries({ queryKey: qk.team });
    },
  });
}
