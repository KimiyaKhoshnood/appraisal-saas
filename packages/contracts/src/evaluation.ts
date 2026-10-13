import { z } from 'zod';
import { uuid } from './common.js';
import type { EvaluationPolicy } from './policy.js';

export const EVALUATION_STATUSES = [
  'DRAFT',
  'SELF_SUBMITTED',
  'MANAGER_SUBMITTED',
  'PENDING_APPROVAL',
  'PUBLISHED',
] as const;
export type EvaluationStatus = (typeof EVALUATION_STATUSES)[number];

export const CYCLE_STATUSES = ['DRAFT', 'ACTIVE', 'CLOSED'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

export const EVALUATOR_KINDS = ['SELF', 'MANAGER'] as const;
export type EvaluatorKind = (typeof EVALUATOR_KINDS)[number];

export const EVALUATION_ACTIONS = [
  'SAVE_SELF',
  'SUBMIT_SELF',
  'SAVE_MANAGER',
  'SUBMIT_MANAGER',
  'APPROVE',
  'REJECT',
] as const;
export type EvaluationAction = (typeof EVALUATION_ACTIONS)[number];

const isoDate = z.iso.date();

export const createCycleSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    startsOn: isoDate,
  })
  .strict();
export type CreateCycleInput = z.infer<typeof createCycleSchema>;

export const competencySchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).nullable().optional(),
    weight: z.number().int().min(1).max(100),
  })
  .strict();

export const replaceCompetenciesSchema = z
  .object({ competencies: z.array(competencySchema).min(1).max(30) })
  .strict()
  .refine((v) => v.competencies.reduce((s, c) => s + c.weight, 0) === 100, {
    message: 'Competency weights must add up to 100',
    path: ['competencies'],
  })
  .refine((v) => new Set(v.competencies.map((c) => c.name.toLowerCase())).size === v.competencies.length, {
    message: 'Competency names must be unique',
    path: ['competencies'],
  });
export type ReplaceCompetenciesInput = z.infer<typeof replaceCompetenciesSchema>;

export const scoreEntrySchema = z
  .object({
    competencyId: uuid,
    score: z.number().int(),
    comment: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const saveScoresSchema = z
  .object({ scores: z.array(scoreEntrySchema).min(1).max(30) })
  .strict();
export type SaveScoresInput = z.infer<typeof saveScoresSchema>;

export const approvalDecisionSchema = z
  .object({ comment: z.string().trim().max(1000).optional() })
  .strict();
export const rejectionSchema = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();

export const EVALUATION_SCOPES = ['mine', 'team', 'approvals', 'all'] as const;
export const listEvaluationsQuerySchema = z
  .object({
    cycleId: uuid.optional(),
    scope: z.enum(EVALUATION_SCOPES).default('mine'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: uuid.optional(),
  })
  .strict();
export type ListEvaluationsQuery = z.infer<typeof listEvaluationsQuerySchema>;

export interface CompetencyView {
  id: string;
  name: string;
  description: string | null;
  weight: number;
}

export interface CycleView {
  id: string;
  name: string;
  status: CycleStatus;
  startsOn: string;
  endsOn: string;
  policy: EvaluationPolicy;
  competencies: CompetencyView[];
  evaluationCount: number;
}

export interface EvaluationSummaryView {
  id: string;
  cycle: { id: string; name: string };
  employee: { id: string; fullName: string };
  manager: { id: string; fullName: string } | null;
  status: EvaluationStatus;
  finalScore: number | null;
  updatedAt: string;
}

export interface EvaluationDetailView extends EvaluationSummaryView {
  policy: EvaluationPolicy;
  competencies: CompetencyView[];
  scores: {
    competencyId: string;
    evaluator: EvaluatorKind;
    score: number;
    comment: string | null;
  }[];
  approvals: {
    approver: { id: string; fullName: string };
    decision: 'APPROVED' | 'REJECTED';
    comment: string | null;
    stage: number;
    createdAt: string;
  }[];
  /** Transitions the *current viewer* may perform now; the server re-checks every one. */
  allowedActions: EvaluationAction[];
  /** False when the policy hides the result from the employee (MANAGERS_ONLY). */
  resultVisibleToEmployee: boolean;
  /** Optimistic-concurrency version, also sent as `ETag: "v<version>"`; send it back in `If-Match`. */
  version: number;
}
