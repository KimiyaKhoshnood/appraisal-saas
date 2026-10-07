import type { ApprovalStrategyKey } from '@appraisal/contracts';

/**
 * Level 3 of the customisation ladder: the *strategy* is shared code, the *choice* is tenant
 * configuration. Adding a strategy means one class + one enum value, and every tenant can use it.
 * There is no `if (tenant === …)` anywhere (enforced by lint).
 */
export interface ApprovalRecordLike {
  approverId: string;
  stage: number;
  decision: 'APPROVED' | 'REJECTED';
}

export interface ApprovalContext {
  approverId: string;
  employeeId: string;
  managerId: string | null;
  /** Approval decisions since the last rejection (the current round). */
  round: ApprovalRecordLike[];
}

export interface ApprovalStrategy {
  readonly key: ApprovalStrategyKey;
  readonly stages: number;
  /** Null when allowed, otherwise the reason. */
  denyReason(ctx: ApprovalContext): string | null;
  /** Stage number the next approval would fill. */
  nextStage(round: ApprovalRecordLike[]): number;
  isComplete(roundAfterThisApproval: ApprovalRecordLike[]): boolean;
}

/** Separation of duties shared by every strategy: you cannot approve your own work or result. */
function baseDenyReason(ctx: ApprovalContext): string | null {
  if (ctx.approverId === ctx.employeeId) return 'You cannot approve your own evaluation';
  if (ctx.approverId === ctx.managerId) return 'The evaluating manager cannot approve their own assessment';
  return null;
}

const approvedCount = (round: ApprovalRecordLike[]) => round.filter((r) => r.decision === 'APPROVED').length;

export class SingleApproval implements ApprovalStrategy {
  readonly key = 'SINGLE' as const;
  readonly stages = 1;
  denyReason(ctx: ApprovalContext) {
    return baseDenyReason(ctx);
  }
  nextStage() {
    return 1;
  }
  isComplete(round: ApprovalRecordLike[]) {
    return approvedCount(round) >= 1;
  }
}

/** Four-eyes principle: two different approvers, neither the manager nor the employee. */
export class TwoStageApproval implements ApprovalStrategy {
  readonly key = 'TWO_STAGE' as const;
  readonly stages = 2;
  denyReason(ctx: ApprovalContext) {
    const base = baseDenyReason(ctx);
    if (base) return base;
    if (ctx.round.some((r) => r.decision === 'APPROVED' && r.approverId === ctx.approverId)) {
      return 'The second stage must be approved by a different person';
    }
    return null;
  }
  nextStage(round: ApprovalRecordLike[]) {
    return Math.min(2, approvedCount(round) + 1);
  }
  isComplete(round: ApprovalRecordLike[]) {
    return approvedCount(round) >= 2;
  }
}

const STRATEGIES: Record<ApprovalStrategyKey, ApprovalStrategy> = {
  SINGLE: new SingleApproval(),
  TWO_STAGE: new TwoStageApproval(),
};

export function approvalStrategy(key: ApprovalStrategyKey): ApprovalStrategy {
  return STRATEGIES[key];
}

/** Decisions after the most recent rejection: a rejection restarts the approval round. */
export function currentRound<T extends ApprovalRecordLike & { createdAt: Date }>(records: T[]): T[] {
  const sorted = [...records].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const lastReject = sorted.map((r) => r.decision).lastIndexOf('REJECTED');
  return sorted.slice(lastReject + 1);
}
