import { Injectable } from '@nestjs/common';
import type {
  EvaluationAction,
  EvaluationDetailView,
  EvaluationPolicy,
  EvaluationStatus,
  EvaluationSummaryView,
  ListEvaluationsQuery,
  Page,
  SaveScoresInput,
} from '@appraisal/contracts';
import {
  BusinessRuleError,
  ConflictError,
  Database,
  EventBus,
  ForbiddenError,
  NotFoundError,
  TenantContext,
  ValidationFailedError,
  keysetArgs,
  toPage,
  type AccessContext,
} from '../../core';
import type { Prisma } from '../../generated/prisma/client';
import { OrgDirectory } from '../organization';
import { parsePolicySnapshot } from './cycles.service';
import { approvalStrategy, currentRound } from './domain/approval-strategy';
import { finalScore, outOfScale } from './domain/scoring';
import { APPROVAL_STATUSES, IllegalTransitionError, managerStageStatus, nextStatus, type TransitionAction } from './domain/state-machine';

const detailInclude = {
  cycle: { include: { competencies: true } },
  scores: true,
  approvals: { orderBy: { createdAt: 'asc' } },
} as const;
type EvaluationRow = Prisma.EvaluationGetPayload<{ include: typeof detailInclude }>;
type Evaluator = 'SELF' | 'MANAGER';

/**
 * Who may *see* an evaluation (the fourth authorisation layer, scope). Anything else is a 404,
 * exactly like a row of another tenant: no one learns that an id exists (T11).
 */
function canRead(e: { employeeId: string; managerId: string | null; status: EvaluationStatus }, access: AccessContext): boolean {
  const me = access.user.id;
  if (e.employeeId === me || e.managerId === me) return true;
  if (access.permissions.has('evaluation:read-all')) return true;
  if (access.permissions.has('evaluation:approve') && (APPROVAL_STATUSES.includes(e.status) || e.status === 'PUBLISHED')) return true;
  return false;
}

@Injectable()
export class EvaluationsService {
  constructor(
    private readonly db: Database,
    private readonly org: OrgDirectory,
    private readonly events: EventBus,
  ) {}

  async list(q: ListEvaluationsQuery): Promise<Page<EvaluationSummaryView>> {
    const access = TenantContext.requireAccess();
    const me = access.user.id;
    let where: Prisma.EvaluationWhereInput;
    switch (q.scope) {
      case 'mine':
        where = { employeeId: me };
        break;
      case 'team':
        where = { managerId: me };
        break;
      case 'approvals':
        if (!access.permissions.has('evaluation:approve')) throw new ForbiddenError('PERMISSION_DENIED', 'Missing permission: evaluation:approve');
        where = { status: { in: [...APPROVAL_STATUSES] }, employeeId: { not: me }, OR: [{ managerId: null }, { managerId: { not: me } }] };
        break;
      case 'all':
        if (!access.permissions.has('evaluation:read-all')) throw new ForbiddenError('PERMISSION_DENIED', 'Missing permission: evaluation:read-all');
        where = {};
        break;
    }
    if (q.cycleId) where = { AND: [where, { cycleId: q.cycleId }] };
    const rows = await this.db.client.evaluation.findMany({
      where,
      include: { cycle: { select: { id: true, name: true, policySnapshot: true } } },
      ...keysetArgs(q.limit, q.cursor, 'asc'),
    });
    const names = await this.org.names(rows.flatMap((r) => [r.employeeId, r.managerId]));
    return toPage(rows, q.limit, (r) => this.summary(r, names, access));
  }

  /** EV-07: an employee's history, visible to the employee, their manager and read-all. */
  async history(employeeId: string): Promise<EvaluationSummaryView[]> {
    const access = TenantContext.requireAccess();
    const me = access.user.id;
    if (!(await this.org.userExists(employeeId))) throw new NotFoundError('employee', employeeId);
    const allowed =
      employeeId === me || access.permissions.has('evaluation:read-all') || (await this.org.managerOf(employeeId)) === me;
    if (!allowed) throw new NotFoundError('employee', employeeId);
    const rows = await this.db.client.evaluation.findMany({
      where: { employeeId },
      include: { cycle: { select: { id: true, name: true, policySnapshot: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const names = await this.org.names(rows.flatMap((r) => [r.employeeId, r.managerId]));
    return rows.map((r) => this.summary(r, names, access));
  }

  async get(id: string): Promise<EvaluationDetailView> {
    const access = TenantContext.requireAccess();
    const e = await this.load(id, access);
    return this.detail(e, access);
  }

  async saveScores(id: string, evaluator: Evaluator, input: SaveScoresInput): Promise<EvaluationDetailView> {
    const access = TenantContext.requireAccess();
    return this.db.transaction(async (tx) => {
      const e = await this.load(id, access);
      const policy = parsePolicySnapshot(e.cycle.policySnapshot);
      this.assertCanEdit(e, evaluator, policy, access);
      this.validateScores(e, policy, input, false);
      await this.upsertScores(tx, e, evaluator, input);
      await this.bumpVersion(tx, e);
      return this.detail(await this.load(id, access), access);
    });
  }

  async submit(id: string, evaluator: Evaluator, input?: SaveScoresInput): Promise<EvaluationDetailView> {
    const access = TenantContext.requireAccess();
    const action: TransitionAction = evaluator === 'SELF' ? 'SUBMIT_SELF' : 'SUBMIT_MANAGER';
    return this.db.transaction(async (tx) => {
      const e = await this.load(id, access);
      const policy = parsePolicySnapshot(e.cycle.policySnapshot);
      this.assertCanEdit(e, evaluator, policy, access);
      if (input) {
        this.validateScores(e, policy, input, false);
        await this.upsertScores(tx, e, evaluator, input);
      }
      const scores = await tx.evaluationScore.findMany({ where: { evaluationId: id, evaluator } });
      const missing = e.cycle.competencies.filter((c) => !scores.some((s) => s.competencyId === c.id));
      if (missing.length) {
        throw new BusinessRuleError(
          'INCOMPLETE_SCORES',
          'Every competency needs a score before submitting',
          missing.map((c) => ({ path: c.id, message: `Missing score for ${c.name}` })),
        );
      }
      const to = this.transition(e.status, action, policy);
      const data: Prisma.EvaluationUpdateManyMutationInput = { status: to };
      if (to === 'PUBLISHED') Object.assign(data, this.publication(e, scores, policy));
      await this.applyTransition(tx, e, data);
      await this.events.publish({
        type: evaluator === 'SELF' ? 'evaluation.self_submitted' : 'evaluation.manager_submitted',
        category: 'CHANGE',
        entityType: 'evaluation',
        entityId: id,
        metadata: { from: e.status, to },
      });
      if (to === 'PUBLISHED') await this.publishedEvent(id);
      return this.detail(await this.load(id, access), access);
    });
  }

  async approve(id: string, comment?: string): Promise<EvaluationDetailView> {
    return this.decide(id, 'APPROVED', comment ?? null);
  }

  async reject(id: string, reason: string): Promise<EvaluationDetailView> {
    return this.decide(id, 'REJECTED', reason);
  }

  private async decide(id: string, decision: 'APPROVED' | 'REJECTED', comment: string | null): Promise<EvaluationDetailView> {
    const access = TenantContext.requireAccess();
    const tenantId = TenantContext.requireTenantId();
    return this.db.transaction(async (tx) => {
      const e = await this.load(id, access);
      const policy = parsePolicySnapshot(e.cycle.policySnapshot);
      this.assertCycleActive(e);
      const strategy = approvalStrategy(policy.approvalStrategy);
      const round = currentRound(e.approvals);
      const deny = strategy.denyReason({ approverId: access.user.id, employeeId: e.employeeId, managerId: e.managerId, round });
      if (deny) throw new ForbiddenError('APPROVAL_NOT_ALLOWED', deny);

      const stage = strategy.nextStage(round);
      const record = { approverId: access.user.id, stage, decision };
      const complete = decision === 'APPROVED' && strategy.isComplete([...round, record]);
      const to = this.transition(e.status, decision === 'APPROVED' ? 'APPROVE' : 'REJECT', policy, complete);

      await tx.approvalRecord.create({ data: { tenantId, evaluationId: id, ...record, comment } });
      const data: Prisma.EvaluationUpdateManyMutationInput = { status: to };
      if (to === 'PUBLISHED') {
        const scores = await tx.evaluationScore.findMany({ where: { evaluationId: id, evaluator: 'MANAGER' } });
        Object.assign(data, this.publication(e, scores, policy));
      }
      await this.applyTransition(tx, e, data);
      await this.events.publish({
        type: decision === 'APPROVED' ? 'evaluation.approved' : 'evaluation.rejected',
        category: 'CHANGE',
        entityType: 'evaluation',
        entityId: id,
        metadata: { from: e.status, to, stage, strategy: strategy.key },
      });
      if (to === 'PUBLISHED') await this.publishedEvent(id);
      return this.detail(await this.load(id, access), access);
    });
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private async load(id: string, access: AccessContext): Promise<EvaluationRow> {
    const e = await this.db.client.evaluation.findUnique({ where: { id }, include: detailInclude });
    if (!e || !canRead(e, access)) throw new NotFoundError('evaluation', id);
    return e;
  }

  private transition(from: EvaluationStatus, action: TransitionAction, policy: EvaluationPolicy, approvalComplete?: boolean) {
    try {
      return nextStatus({ from, action, policy, ...(approvalComplete !== undefined ? { approvalComplete } : {}) });
    } catch (err) {
      if (err instanceof IllegalTransitionError) throw new BusinessRuleError('ILLEGAL_TRANSITION', err.message);
      throw err;
    }
  }

  private assertCycleActive(e: EvaluationRow) {
    if (e.cycle.status !== 'ACTIVE') throw new BusinessRuleError('CYCLE_NOT_ACTIVE', 'The cycle is not active');
  }

  private assertCanEdit(e: EvaluationRow, evaluator: Evaluator, policy: EvaluationPolicy, access: AccessContext) {
    this.assertCycleActive(e);
    const me = access.user.id;
    if (evaluator === 'SELF') {
      if (e.employeeId !== me || !access.permissions.has('evaluation:self')) {
        throw new ForbiddenError('NOT_YOUR_EVALUATION', 'Only the employee can fill in the self-assessment');
      }
      if (!policy.selfAssessmentRequired) {
        throw new BusinessRuleError('SELF_ASSESSMENT_DISABLED', 'Self-assessment is not part of this cycle');
      }
      if (e.status !== 'DRAFT') throw new BusinessRuleError('ILLEGAL_TRANSITION', 'The self-assessment was already submitted');
    } else {
      // EV-04: only the manager recorded on the evaluation, holding evaluation:manage.
      if (e.managerId !== me || !access.permissions.has('evaluation:manage')) {
        throw new ForbiddenError('NOT_YOUR_REPORT', 'Only the employee’s manager can evaluate them');
      }
      if (e.status !== managerStageStatus(policy)) {
        throw new BusinessRuleError(
          'ILLEGAL_TRANSITION',
          e.status === 'DRAFT' ? 'Waiting for the employee’s self-assessment' : 'The manager stage is over',
        );
      }
    }
  }

  private validateScores(e: EvaluationRow, policy: EvaluationPolicy, input: SaveScoresInput, _requireAll: boolean) {
    const known = new Set(e.cycle.competencies.map((c) => c.id));
    const errors: { path: string; message: string }[] = [];
    const seen = new Set<string>();
    input.scores.forEach((s, i) => {
      if (!known.has(s.competencyId)) errors.push({ path: `scores.${i}.competencyId`, message: 'Not a competency of this cycle' });
      if (seen.has(s.competencyId)) errors.push({ path: `scores.${i}.competencyId`, message: 'Duplicate competency' });
      seen.add(s.competencyId);
      if (outOfScale(s.score, policy.scale)) {
        errors.push({ path: `scores.${i}.score`, message: `Must be an integer between ${policy.scale.min} and ${policy.scale.max}` });
      }
    });
    if (errors.length) throw new ValidationFailedError(errors);
  }

  private async upsertScores(tx: { evaluationScore: Database['client']['evaluationScore'] }, e: EvaluationRow, evaluator: Evaluator, input: SaveScoresInput) {
    for (const s of input.scores) {
      await tx.evaluationScore.upsert({
        where: {
          tenantId_evaluationId_competencyId_evaluator: { tenantId: e.tenantId, evaluationId: e.id, competencyId: s.competencyId, evaluator },
        },
        create: { tenantId: e.tenantId, evaluationId: e.id, competencyId: s.competencyId, evaluator, score: s.score, comment: s.comment ?? null },
        update: { score: s.score, comment: s.comment ?? null },
      });
    }
  }

  /** Optimistic concurrency: two people acting on the same evaluation cannot both win. */
  private async applyTransition(tx: { evaluation: Database['client']['evaluation'] }, e: EvaluationRow, data: Prisma.EvaluationUpdateManyMutationInput) {
    const { count } = await tx.evaluation.updateMany({
      where: { id: e.id, version: e.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (count !== 1) throw new ConflictError('STALE_EVALUATION', 'The evaluation changed meanwhile; reload and try again');
  }

  private async bumpVersion(tx: { evaluation: Database['client']['evaluation'] }, e: EvaluationRow) {
    await this.applyTransition(tx, e, {});
  }

  private publication(e: EvaluationRow, scores: { competencyId: string; score: number; evaluator: string }[], policy: EvaluationPolicy) {
    const weights = new Map(e.cycle.competencies.map((c) => [c.id, c.weight]));
    const managerScores = scores
      .filter((s) => s.evaluator === 'MANAGER')
      .map((s) => ({ weight: weights.get(s.competencyId) ?? 0, score: s.score }));
    return { finalScore: finalScore(managerScores, policy.scale), publishedAt: new Date() };
  }

  private async publishedEvent(id: string) {
    await this.events.publish({ type: 'evaluation.published', category: 'CHANGE', entityType: 'evaluation', entityId: id });
  }

  private summary(
    r: { id: string; employeeId: string; managerId: string | null; status: EvaluationStatus; finalScore: Prisma.Decimal | null; updatedAt: Date; cycle: { id: string; name: string; policySnapshot: unknown } },
    names: Map<string, string>,
    access: AccessContext,
  ): EvaluationSummaryView {
    const policy = parsePolicySnapshot(r.cycle.policySnapshot);
    return {
      id: r.id,
      cycle: { id: r.cycle.id, name: r.cycle.name },
      employee: { id: r.employeeId, fullName: names.get(r.employeeId) ?? '' },
      manager: r.managerId ? { id: r.managerId, fullName: names.get(r.managerId) ?? '' } : null,
      status: r.status,
      finalScore: this.resultVisible(r, policy, access) && r.finalScore !== null ? Number(r.finalScore) : null,
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  /** EV-06: the employee sees the manager's result only when the policy says so. */
  private resultVisible(e: { employeeId: string; status: EvaluationStatus }, policy: EvaluationPolicy, access: AccessContext): boolean {
    if (e.status !== 'PUBLISHED') return e.employeeId !== access.user.id;
    if (e.employeeId !== access.user.id) return true;
    return policy.resultVisibility === 'AFTER_PUBLISH';
  }

  private async detail(e: EvaluationRow, access: AccessContext): Promise<EvaluationDetailView> {
    const policy = parsePolicySnapshot(e.cycle.policySnapshot);
    const me = access.user.id;
    const isEmployee = e.employeeId === me;
    const managerVisible = this.resultVisible(e, policy, access);
    const names = await this.org.names([e.employeeId, e.managerId, ...e.approvals.map((a) => a.approverId)]);

    const scores = e.scores
      // The employee never sees the manager's draft; after publish, only if the policy allows.
      .filter((s) => s.evaluator === 'SELF' || !isEmployee || managerVisible)
      .map((s) => ({ competencyId: s.competencyId, evaluator: s.evaluator, score: s.score, comment: s.comment }));

    return {
      ...this.summary({ ...e, cycle: e.cycle }, names, access),
      policy,
      competencies: [...e.cycle.competencies]
        .sort((a, b) => a.position - b.position)
        .map((c) => ({ id: c.id, name: c.name, description: c.description, weight: c.weight })),
      scores,
      approvals: isEmployee && !managerVisible
        ? []
        : e.approvals.map((a) => ({
            approver: { id: a.approverId, fullName: names.get(a.approverId) ?? '' },
            decision: a.decision,
            comment: a.comment,
            stage: a.stage,
            createdAt: a.createdAt.toISOString(),
          })),
      allowedActions: this.allowedActions(e, policy, access),
      resultVisibleToEmployee: policy.resultVisibility === 'AFTER_PUBLISH',
    };
  }

  private allowedActions(e: EvaluationRow, policy: EvaluationPolicy, access: AccessContext): EvaluationAction[] {
    if (e.cycle.status !== 'ACTIVE') return [];
    const me = access.user.id;
    const actions: EvaluationAction[] = [];
    if (policy.selfAssessmentRequired && e.employeeId === me && e.status === 'DRAFT' && access.permissions.has('evaluation:self')) {
      actions.push('SAVE_SELF', 'SUBMIT_SELF');
    }
    if (e.managerId === me && e.status === managerStageStatus(policy) && access.permissions.has('evaluation:manage')) {
      actions.push('SAVE_MANAGER', 'SUBMIT_MANAGER');
    }
    if (policy.approvalRequired && APPROVAL_STATUSES.includes(e.status) && access.permissions.has('evaluation:approve')) {
      const deny = approvalStrategy(policy.approvalStrategy).denyReason({
        approverId: me,
        employeeId: e.employeeId,
        managerId: e.managerId,
        round: currentRound(e.approvals),
      });
      if (!deny) actions.push('APPROVE', 'REJECT');
    }
    return actions;
  }
}
