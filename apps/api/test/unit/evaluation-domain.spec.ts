import type { EvaluationStatus } from '@appraisal/contracts';
import { SingleApproval, TwoStageApproval, approvalStrategy, currentRound } from '../../src/modules/evaluation/domain/approval-strategy';
import { cycleEnd, finalScore, outOfScale } from '../../src/modules/evaluation/domain/scoring';
import { IllegalTransitionError, nextStatus, reachableStatuses, type TransitionAction } from '../../src/modules/evaluation/domain/state-machine';

const POLICIES = [
  { selfAssessmentRequired: true, approvalRequired: true },
  { selfAssessmentRequired: true, approvalRequired: false },
  { selfAssessmentRequired: false, approvalRequired: true },
  { selfAssessmentRequired: false, approvalRequired: false },
] as const;

const STATUSES: EvaluationStatus[] = ['DRAFT', 'SELF_SUBMITTED', 'MANAGER_SUBMITTED', 'PENDING_APPROVAL', 'PUBLISHED'];
const ACTIONS: TransitionAction[] = ['SUBMIT_SELF', 'SUBMIT_MANAGER', 'APPROVE', 'REJECT'];

function legal(from: EvaluationStatus, action: TransitionAction, policy: (typeof POLICIES)[number], approvalComplete = true) {
  try {
    return nextStatus({ from, action, policy, approvalComplete });
  } catch (e) {
    if (e instanceof IllegalTransitionError) return null;
    throw e;
  }
}

describe('evaluation state machine', () => {
  it('matches the expected transition table for every policy (exhaustive)', () => {
    const table: Record<string, Record<string, string | null>> = {};
    for (const p of POLICIES) {
      const key = `self=${p.selfAssessmentRequired},approval=${p.approvalRequired}`;
      table[key] = {};
      for (const s of STATUSES) for (const a of ACTIONS) table[key]![`${s}+${a}`] = legal(s, a, p);
    }
    expect(table).toMatchSnapshot();
  });

  it('the happy path of each policy reaches PUBLISHED', () => {
    for (const p of POLICIES) {
      let s: EvaluationStatus = 'DRAFT';
      if (p.selfAssessmentRequired) s = nextStatus({ from: s, action: 'SUBMIT_SELF', policy: p });
      s = nextStatus({ from: s, action: 'SUBMIT_MANAGER', policy: p });
      if (p.approvalRequired) s = nextStatus({ from: s, action: 'APPROVE', policy: p, approvalComplete: true });
      expect(s).toBe('PUBLISHED');
    }
  });

  it('PUBLISHED is terminal', () => {
    for (const p of POLICIES) for (const a of ACTIONS) expect(legal('PUBLISHED', a, p)).toBeNull();
  });

  it('a partial approval parks the evaluation in PENDING_APPROVAL; a rejection returns it to the manager', () => {
    const p = { selfAssessmentRequired: true, approvalRequired: true };
    expect(nextStatus({ from: 'MANAGER_SUBMITTED', action: 'APPROVE', policy: p, approvalComplete: false })).toBe('PENDING_APPROVAL');
    expect(nextStatus({ from: 'PENDING_APPROVAL', action: 'APPROVE', policy: p, approvalComplete: true })).toBe('PUBLISHED');
    expect(nextStatus({ from: 'PENDING_APPROVAL', action: 'REJECT', policy: p })).toBe('SELF_SUBMITTED');
    expect(nextStatus({ from: 'MANAGER_SUBMITTED', action: 'REJECT', policy: { ...p, selfAssessmentRequired: false } })).toBe('DRAFT');
  });

  it('lists the statuses a policy can reach', () => {
    expect(reachableStatuses({ selfAssessmentRequired: false, approvalRequired: false })).toEqual(['DRAFT', 'PUBLISHED']);
    expect(reachableStatuses({ selfAssessmentRequired: true, approvalRequired: true })).toEqual(STATUSES);
  });
});

describe('approval strategies (customisation level 3)', () => {
  const ctx = { employeeId: 'emp', managerId: 'mgr', round: [] as { approverId: string; stage: number; decision: 'APPROVED' | 'REJECTED' }[] };

  it('both forbid self-approval and approval by the evaluating manager', () => {
    for (const s of [new SingleApproval(), new TwoStageApproval()]) {
      expect(s.denyReason({ ...ctx, approverId: 'emp' })).toMatch(/own evaluation/);
      expect(s.denyReason({ ...ctx, approverId: 'mgr' })).toMatch(/manager/);
      expect(s.denyReason({ ...ctx, approverId: 'hr' })).toBeNull();
    }
  });

  it('SINGLE completes with one approval', () => {
    const s = approvalStrategy('SINGLE');
    expect(s.nextStage([])).toBe(1);
    expect(s.isComplete([{ approverId: 'hr', stage: 1, decision: 'APPROVED' }])).toBe(true);
  });

  it('TWO_STAGE needs two distinct approvers', () => {
    const s = approvalStrategy('TWO_STAGE');
    const one = [{ approverId: 'hr', stage: 1, decision: 'APPROVED' as const }];
    expect(s.isComplete(one)).toBe(false);
    expect(s.nextStage(one)).toBe(2);
    expect(s.denyReason({ ...ctx, approverId: 'hr', round: one })).toMatch(/different person/);
    expect(s.isComplete([...one, { approverId: 'ceo', stage: 2, decision: 'APPROVED' }])).toBe(true);
  });

  it('a rejection starts a new approval round', () => {
    const at = (m: number) => new Date(2026, 0, 1, 0, m);
    const records = [
      { approverId: 'hr', stage: 1, decision: 'APPROVED' as const, createdAt: at(1) },
      { approverId: 'ceo', stage: 2, decision: 'REJECTED' as const, createdAt: at(2) },
      { approverId: 'hr', stage: 1, decision: 'APPROVED' as const, createdAt: at(3) },
    ];
    expect(currentRound(records).map((r) => r.createdAt)).toEqual([at(3)]);
  });
});

describe('scoring', () => {
  it('normalises any scale to 0–100 and weights competencies', () => {
    expect(finalScore([{ weight: 100, score: 4 }], { min: 1, max: 5 })).toBe(75);
    expect(finalScore([{ weight: 60, score: 10 }, { weight: 40, score: 1 }], { min: 1, max: 10 })).toBe(60);
    expect(finalScore([{ weight: 50, score: 3 }, { weight: 50, score: 3 }], { min: 1, max: 5 })).toBe(50);
    expect(finalScore([], { min: 1, max: 5 })).toBe(0);
  });

  it('rejects non-integers and out-of-scale values', () => {
    expect(outOfScale(0, { min: 1, max: 5 })).toBe(true);
    expect(outOfScale(6, { min: 1, max: 5 })).toBe(true);
    expect(outOfScale(2.5, { min: 1, max: 5 })).toBe(true);
    expect(outOfScale(5, { min: 1, max: 5 })).toBe(false);
  });

  it('computes inclusive cycle ends per cadence', () => {
    const start = new Date('2026-07-01T00:00:00Z');
    expect(cycleEnd(start, 'MONTHLY').toISOString().slice(0, 10)).toBe('2026-07-31');
    expect(cycleEnd(start, 'QUARTERLY').toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(cycleEnd(start, 'YEARLY').toISOString().slice(0, 10)).toBe('2027-06-30');
  });
});
