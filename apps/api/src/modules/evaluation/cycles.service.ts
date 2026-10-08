import { Injectable } from '@nestjs/common';
import {
  evaluationPolicySchema,
  type CreateCycleInput,
  type CycleView,
  type EvaluationPolicy,
  type ReplaceCompetenciesInput,
} from '@appraisal/contracts';
import { BusinessRuleError, ConflictError, Database, EventBus, NotFoundError, TenantContext } from '../../core';
import type { Prisma } from '../../generated/prisma/client';
import { ConfigurationService } from '../configuration';
import { OrgDirectory } from '../organization';
import { cycleEnd } from './domain/scoring';

const DEFAULT_COMPETENCIES = [
  { name: 'Delivery', description: 'Plans and delivers agreed outcomes', weight: 40 },
  { name: 'Collaboration', description: 'Works effectively with others', weight: 30 },
  { name: 'Growth', description: 'Learns and helps others learn', weight: 30 },
];

type CycleRow = Prisma.EvaluationCycleGetPayload<{ include: { competencies: true; _count: { select: { evaluations: true } } } }>;

export function parsePolicySnapshot(raw: unknown): EvaluationPolicy {
  return evaluationPolicySchema.parse(raw);
}

function toView(c: CycleRow): CycleView {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    startsOn: c.startsOn.toISOString().slice(0, 10),
    endsOn: c.endsOn.toISOString().slice(0, 10),
    policy: parsePolicySnapshot(c.policySnapshot),
    competencies: [...c.competencies]
      .sort((a, b) => a.position - b.position)
      .map((x) => ({ id: x.id, name: x.name, description: x.description, weight: x.weight })),
    evaluationCount: c._count.evaluations,
  };
}

const include = { competencies: true, _count: { select: { evaluations: true } } } as const;

@Injectable()
export class CyclesService {
  constructor(
    private readonly db: Database,
    private readonly config: ConfigurationService,
    private readonly org: OrgDirectory,
    private readonly events: EventBus,
  ) {}

  async list(): Promise<CycleView[]> {
    const rows = await this.db.client.evaluationCycle.findMany({ orderBy: { startsOn: 'desc' }, include });
    return rows.map(toView);
  }

  async get(id: string): Promise<CycleView> {
    const row = await this.db.client.evaluationCycle.findUnique({ where: { id }, include });
    if (!row) throw new NotFoundError('cycle', id);
    return toView(row);
  }

  /**
   * EV-01. The *effective* policy is frozen into the cycle: a later policy change applies to the
   * next cycle and never breaks one in progress.
   */
  async create(input: CreateCycleInput): Promise<CycleView> {
    const tenantId = TenantContext.requireTenantId();
    const { tenant } = TenantContext.requireAccess();
    const policy = (await this.config.effective(tenant.plan)).policy;
    const startsOn = new Date(`${input.startsOn}T00:00:00Z`);
    return this.db.transaction(async (tx) => {
      const previous = await tx.evaluationCycle.findFirst({ orderBy: { startsOn: 'desc' }, include: { competencies: true } });
      const template = previous?.competencies.length
        ? [...previous.competencies]
            .sort((a, b) => a.position - b.position)
            .map(({ name, description, weight }) => ({ name, description, weight }))
        : DEFAULT_COMPETENCIES;
      const cycle = await tx.evaluationCycle.create({
        data: {
          tenantId,
          name: input.name,
          startsOn,
          endsOn: cycleEnd(startsOn, policy.cycle),
          policySnapshot: policy as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.competency.createMany({
        data: template.map((c, position) => ({ tenantId, cycleId: cycle.id, position, ...c })),
      });
      await this.events.publish({
        type: 'evaluation.cycle.created',
        category: 'CHANGE',
        entityType: 'cycle',
        entityId: cycle.id,
        metadata: { cadence: policy.cycle, approvalRequired: policy.approvalRequired, approvalStrategy: policy.approvalStrategy },
      });
      return this.get(cycle.id);
    });
  }

  /** EV-02: competencies are editable while the cycle is a draft; weights must total 100. */
  async replaceCompetencies(id: string, input: ReplaceCompetenciesInput): Promise<CycleView> {
    const tenantId = TenantContext.requireTenantId();
    return this.db.transaction(async (tx) => {
      const cycle = await tx.evaluationCycle.findUnique({ where: { id } });
      if (!cycle) throw new NotFoundError('cycle', id);
      if (cycle.status !== 'DRAFT') {
        throw new BusinessRuleError('CYCLE_NOT_DRAFT', 'Competencies can only change before the cycle is activated');
      }
      await tx.competency.deleteMany({ where: { cycleId: id } });
      await tx.competency.createMany({
        data: input.competencies.map((c, position) => ({
          tenantId,
          cycleId: id,
          position,
          name: c.name,
          description: c.description ?? null,
          weight: c.weight,
        })),
      });
      await this.events.publish({
        type: 'evaluation.cycle.competencies_replaced',
        category: 'CHANGE',
        entityType: 'cycle',
        entityId: id,
        metadata: { count: input.competencies.length },
      });
      return this.get(id);
    });
  }

  /**
   * Opens the cycle: one evaluation per active employee who has a manager. The manager is copied
   * onto the evaluation (reporting lines may change mid-cycle; the evaluator does not).
   */
  async activate(id: string): Promise<CycleView & { skippedWithoutManager: number }> {
    const tenantId = TenantContext.requireTenantId();
    const roster = await this.org.activeRoster();
    return this.db.transaction(async (tx) => {
      const cycle = await tx.evaluationCycle.findUnique({ where: { id }, include: { competencies: true } });
      if (!cycle) throw new NotFoundError('cycle', id);
      if (cycle.status !== 'DRAFT') throw new BusinessRuleError('CYCLE_NOT_DRAFT', 'Only a draft cycle can be activated');
      const total = cycle.competencies.reduce((s, c) => s + c.weight, 0);
      if (total !== 100) throw new BusinessRuleError('WEIGHTS_NOT_100', `Competency weights add up to ${total}, not 100`);
      if (await tx.evaluationCycle.count({ where: { status: 'ACTIVE' } })) {
        throw new BusinessRuleError('CYCLE_ALREADY_ACTIVE', 'Close the active cycle before activating another one');
      }

      const withManager = roster.filter((r) => r.managerId);
      await tx.evaluation.createMany({
        data: withManager.map((r) => ({ tenantId, cycleId: id, employeeId: r.userId, managerId: r.managerId })),
      });
      // Guarded transition; the partial unique index `evaluation_cycle_one_active` turns a
      // concurrent second activation into a unique violation (409) instead of two active cycles.
      const { count } = await tx.evaluationCycle.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'ACTIVE', activatedAt: new Date() } });
      if (count !== 1) throw new ConflictError('STALE_CYCLE', 'The cycle changed meanwhile; reload and try again');
      await this.events.publish({
        type: 'evaluation.cycle.activated',
        category: 'CHANGE',
        entityType: 'cycle',
        entityId: id,
        metadata: { evaluations: withManager.length, skippedWithoutManager: roster.length - withManager.length },
      });
      return { ...(await this.get(id)), skippedWithoutManager: roster.length - withManager.length };
    });
  }

  async close(id: string): Promise<CycleView> {
    return this.db.transaction(async (tx) => {
      const cycle = await tx.evaluationCycle.findUnique({ where: { id } });
      if (!cycle) throw new NotFoundError('cycle', id);
      if (cycle.status !== 'ACTIVE') throw new BusinessRuleError('CYCLE_NOT_ACTIVE', 'Only an active cycle can be closed');
      const { count } = await tx.evaluationCycle.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'CLOSED', closedAt: new Date() } });
      if (count !== 1) throw new ConflictError('STALE_CYCLE', 'The cycle changed meanwhile; reload and try again');
      const open = await tx.evaluation.count({ where: { cycleId: id, status: { not: 'PUBLISHED' } } });
      await this.events.publish({
        type: 'evaluation.cycle.closed',
        category: 'CHANGE',
        entityType: 'cycle',
        entityId: id,
        metadata: { unpublished: open },
      });
      return this.get(id);
    });
  }
}
