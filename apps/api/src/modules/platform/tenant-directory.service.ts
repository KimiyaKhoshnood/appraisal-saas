import { Injectable } from '@nestjs/common';
import type { PlanCode, TenantStatus } from '@appraisal/contracts';
import { Database, TtlCache, type TenantLookup, type TenantRecord } from '../../core';

/** Cache window for tenant status: a suspension is enforced everywhere within this time (T8). */
export const TENANT_STATUS_TTL_MS = 5_000;

/**
 * Implements the core TenantLookup port. The `tenant` table is a platform table (no RLS); it is
 * read on every request, so lookups are cached briefly and invalidated locally on change.
 */
@Injectable()
export class TenantDirectoryService implements TenantLookup {
  private readonly bySlugCache = new TtlCache<TenantRecord | null>(TENANT_STATUS_TTL_MS, 50_000);
  private readonly byIdCache = new TtlCache<TenantRecord | null>(TENANT_STATUS_TTL_MS, 50_000);

  constructor(private readonly db: Database) {}

  bySlug(slug: string): Promise<TenantRecord | null> {
    return this.bySlugCache.getOrLoad(slug, async () => this.toRecord(await this.db.client.tenant.findUnique({ where: { slug } })));
  }

  byId(id: string): Promise<TenantRecord | null> {
    return this.byIdCache.getOrLoad(id, async () => this.toRecord(await this.db.client.tenant.findUnique({ where: { id } })));
  }

  invalidate(tenant: { id: string; slug: string }): void {
    this.byIdCache.delete(tenant.id);
    this.bySlugCache.delete(tenant.slug);
  }

  private toRecord(
    row: { id: string; slug: string; name: string; planCode: string; status: string } | null,
  ): TenantRecord | null {
    if (!row) return null;
    return { id: row.id, slug: row.slug, name: row.name, plan: row.planCode as PlanCode, status: row.status as TenantStatus };
  }
}
