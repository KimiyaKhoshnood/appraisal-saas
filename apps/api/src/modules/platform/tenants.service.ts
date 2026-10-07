import { Injectable } from '@nestjs/common';
import {
  PLANS,
  PLAN_CODES,
  type CreateTenantInput,
  type PlanCode,
  type TenantStatus,
  type TenantSummary,
} from '@appraisal/contracts';
import { BusinessRuleError, ConflictError, Database, EventBus, NotFoundError, TenantContext } from '../../core';
import { ConfigurationService } from '../configuration';
import { IamProvisioning } from '../iam';
import { PlatformAuditService } from './platform-audit.service';
import { TenantDirectoryService } from './tenant-directory.service';

type TenantRow = { id: string; name: string; slug: string; planCode: string; status: string; createdAt: Date };
const toSummary = (t: TenantRow): TenantSummary => ({
  id: t.id,
  name: t.name,
  slug: t.slug,
  plan: t.planCode,
  status: t.status as TenantStatus,
  createdAt: t.createdAt.toISOString(),
});

export interface ProvisionResult {
  tenant: TenantSummary;
  adminUserId: string;
  /** Wall-clock time of the whole provisioning transaction, shown in demo 1 (NF-11). */
  durationMs: number;
}

/**
 * Tenant lifecycle (PL-01..PL-03). Adding a customer is adding data: one transaction, no
 * deployment, no restart, no new schema. The platform never bypasses RLS to do it: it *enters*
 * the new tenant's context and writes through the same policies as everyone else (ADR-012).
 */
@Injectable()
export class TenantsService {
  constructor(
    private readonly db: Database,
    private readonly directory: TenantDirectoryService,
    private readonly config: ConfigurationService,
    private readonly iam: IamProvisioning,
    private readonly platformAudit: PlatformAuditService,
    private readonly events: EventBus,
  ) {}

  async list(): Promise<TenantSummary[]> {
    const rows = await this.db.client.tenant.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(toSummary);
  }

  async get(id: string): Promise<TenantSummary> {
    const row = await this.db.client.tenant.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('tenant', id);
    return toSummary(row);
  }

  async create(input: CreateTenantInput): Promise<ProvisionResult> {
    const started = performance.now();
    const plan = input.plan as PlanCode;
    if (await this.db.client.tenant.findUnique({ where: { slug: input.slug }, select: { id: true } })) {
      throw new ConflictError('SLUG_TAKEN', 'This sub-domain is already in use');
    }
    const [row] = await this.db.base.$queryRaw<{ id: string }[]>`SELECT uuidv7()::text AS id`;
    const id = row!.id;
    const actor = TenantContext.actor();

    const result = await TenantContext.runAs(id, actor, () =>
      this.db.transaction(async (tx) => {
        await tx.tenant.create({ data: { id: id, name: input.name, slug: input.slug, planCode: plan, status: 'PROVISIONING' } });
        await tx.tenantDirectory.create({ data: { tenantId: id, shard: 'primary' } });
        await this.config.provision({
          plan,
          tenantName: input.name,
          ...(input.branding ? { branding: input.branding } : {}),
          ...(input.features ? { features: input.features } : {}),
          ...(input.evaluationPolicy ? { policy: input.evaluationPolicy } : {}),
        });
        const { adminUserId } = await this.iam.provision(input.admin);
        // Everything above is one transaction: either the tenant exists completely or not at all.
        const tenant = await tx.tenant.update({ where: { id: id }, data: { status: 'ACTIVE' } });
        await this.events.publish({
          type: 'platform.tenant.created',
          category: 'CHANGE',
          entityType: 'tenant',
          entityId: id,
          metadata: { plan, slug: input.slug },
        });
        await this.platformAudit.write({
          type: 'platform.tenant.created',
          category: 'CHANGE',
          entityType: 'tenant',
          entityId: id,
          metadata: { plan, slug: input.slug },
        });
        return { tenant, adminUserId };
      }),
    );
    return { tenant: toSummary(result.tenant), adminUserId: result.adminUserId, durationMs: Math.round(performance.now() - started) };
  }

  async setStatus(id: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<TenantSummary> {
    const row = await this.db.client.tenant.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('tenant', id);
    if (row.status === 'ARCHIVED' || row.status === 'PROVISIONING') {
      throw new BusinessRuleError('INVALID_TENANT_STATE', `A ${row.status.toLowerCase()} tenant cannot be ${status.toLowerCase()}`);
    }
    if (row.status === status) return toSummary(row);
    const updated = await this.db.platformTransaction(async (tx) => {
      const t = await tx.tenant.update({
        where: { id },
        data: { status, suspendedAt: status === 'SUSPENDED' ? new Date() : null },
      });
      await this.events.publish({
        type: status === 'SUSPENDED' ? 'platform.tenant.suspended' : 'platform.tenant.activated',
        category: 'CHANGE',
        entityType: 'tenant',
        entityId: id,
      });
      return t;
    });
    this.directory.invalidate(row);
    // Also leave a trace in the tenant's own audit log: its admins can see what the platform did.
    await TenantContext.runAs(id, TenantContext.actor(), () =>
      this.events.publish({
        type: status === 'SUSPENDED' ? 'platform.tenant.suspended' : 'platform.tenant.activated',
        category: 'CHANGE',
        entityType: 'tenant',
        entityId: id,
      }),
    );
    return toSummary(updated);
  }

  async changePlan(id: string, plan: PlanCode): Promise<TenantSummary> {
    const row = await this.db.client.tenant.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('tenant', id);
    const updated = await this.db.platformTransaction(async (tx) => {
      const t = await tx.tenant.update({ where: { id }, data: { planCode: plan } });
      await this.events.publish({
        type: 'platform.tenant.plan_changed',
        category: 'CHANGE',
        entityType: 'tenant',
        entityId: id,
        metadata: { from: row.planCode, to: plan },
      });
      return t;
    });
    this.directory.invalidate(row);
    return toSummary(updated);
  }

  plans() {
    return PLAN_CODES.map((code) => ({ code, name: PLANS[code].name, features: PLANS[code].features }));
  }
}
