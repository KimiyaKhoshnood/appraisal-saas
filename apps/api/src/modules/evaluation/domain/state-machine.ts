import type { EvaluationPolicy, EvaluationStatus } from '@appraisal/contracts';

/**
 * The evaluation life-cycle. One piece of code; the tenant policy prunes it into different
 * behaviours: "one code, two behaviours", the simplest demonstration of configuration over code.
 *
 *   DRAFT ──SUBMIT_SELF──▶ SELF_SUBMITTED ──SUBMIT_MANAGER──▶ MANAGER_SUBMITTED ──APPROVE*──▶ PUBLISHED
 *     │   (selfAssessmentRequired)                │                  │      ▲
 *     └──────────SUBMIT_MANAGER (self not required)┘                  │      │
 *                                                 (approval not required) ───┘ (straight to PUBLISHED)
 *
 *   MANAGER_SUBMITTED  submitted by the manager, waiting for the first approval decision
 *   PENDING_APPROVAL   partially approved: TWO_STAGE strategy, stage 1 done, stage 2 pending
 *   REJECT (from either approval state) returns the evaluation to the manager.
 */
export type TransitionAction = 'SUBMIT_SELF' | 'SUBMIT_MANAGER' | 'APPROVE' | 'REJECT';

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: EvaluationStatus,
    readonly action: TransitionAction,
    readonly reason: string,
  ) {
    super(`Cannot ${action} an evaluation in status ${from}: ${reason}`);
    this.name = 'IllegalTransitionError';
  }
}

/** Status in which the manager is expected to score. */
export function managerStageStatus(policy: Pick<EvaluationPolicy, 'selfAssessmentRequired'>): EvaluationStatus {
  return policy.selfAssessmentRequired ? 'SELF_SUBMITTED' : 'DRAFT';
}

export const APPROVAL_STATUSES: readonly EvaluationStatus[] = ['MANAGER_SUBMITTED', 'PENDING_APPROVAL'];

export interface TransitionInput {
  from: EvaluationStatus;
  action: TransitionAction;
  policy: Pick<EvaluationPolicy, 'selfAssessmentRequired' | 'approvalRequired'>;
  /** For APPROVE: whether this approval completes the strategy (all required stages done). */
  approvalComplete?: boolean;
}

export function nextStatus({ from, action, policy, approvalComplete }: TransitionInput): EvaluationStatus {
  switch (action) {
    case 'SUBMIT_SELF':
      if (!policy.selfAssessmentRequired) throw new IllegalTransitionError(from, action, 'self-assessment is not part of this policy');
      if (from !== 'DRAFT') throw new IllegalTransitionError(from, action, 'self-assessment was already submitted');
      return 'SELF_SUBMITTED';

    case 'SUBMIT_MANAGER': {
      const expected = managerStageStatus(policy);
      if (from !== expected) {
        throw new IllegalTransitionError(
          from,
          action,
          from === 'DRAFT' ? 'the employee has not submitted the self-assessment yet' : 'the manager stage is over',
        );
      }
      return policy.approvalRequired ? 'MANAGER_SUBMITTED' : 'PUBLISHED';
    }

    case 'APPROVE':
      if (!policy.approvalRequired) throw new IllegalTransitionError(from, action, 'approval is not part of this policy');
      if (!APPROVAL_STATUSES.includes(from)) throw new IllegalTransitionError(from, action, 'nothing is awaiting approval');
      return approvalComplete ? 'PUBLISHED' : 'PENDING_APPROVAL';

    case 'REJECT':
      if (!policy.approvalRequired) throw new IllegalTransitionError(from, action, 'approval is not part of this policy');
      if (!APPROVAL_STATUSES.includes(from)) throw new IllegalTransitionError(from, action, 'nothing is awaiting approval');
      return managerStageStatus(policy);
  }
}

/** Every status reachable under a policy: used by tests and by the docs' state diagram. */
export function reachableStatuses(policy: Pick<EvaluationPolicy, 'selfAssessmentRequired' | 'approvalRequired'>): EvaluationStatus[] {
  const statuses: EvaluationStatus[] = ['DRAFT'];
  if (policy.selfAssessmentRequired) statuses.push('SELF_SUBMITTED');
  if (policy.approvalRequired) statuses.push('MANAGER_SUBMITTED', 'PENDING_APPROVAL');
  statuses.push('PUBLISHED');
  return statuses;
}
