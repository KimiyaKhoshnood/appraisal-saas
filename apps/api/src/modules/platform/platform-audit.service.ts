import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Page } from '@appraisal/contracts';
import { Database, EventBus, TenantContext, keysetArgs, toPage, type DomainEvent } from '../../core';
import type { Prisma } from '../../generated/prisma/client';
import { sanitizeMetadata } from '../audit';

export interface PlatformAuditEntry {
  id: string;
  category: string;
  action: string;
  actor: { id: string; fullName: string } | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** PL-05: operations of platform admins, recorded outside any tenant (append-only table). */
@Injectable()
export class PlatformAuditService implements OnModuleInit {
  constructor(
    private readonly db: Database,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(async (event) => {
      const store = TenantContext.current();
      if (store?.tenantId || store?.actor.type !== 'PLATFORM_ADMIN') return;
      await this.write(event);
    });
  }

  async write(event: DomainEvent): Promise<void> {
    const store = TenantContext.current();
    await this.db.client.platformAuditLog.create({
      data: {
        actorId: store?.actor.id ?? null,
        actorName: store?.actor.name ?? null,
        category: event.category,
        action: event.type,
        entityType: event.entityType ?? null,
        entityId: event.entityId ?? null,
        metadata: sanitizeMetadata(event.metadata) as Prisma.InputJsonValue,
        requestId: store?.requestId ?? null,
      },
    });
  }

  async list(limit: number, cursor?: string): Promise<Page<PlatformAuditEntry>> {
    const rows = await this.db.client.platformAuditLog.findMany(keysetArgs(limit, cursor));
    return toPage(rows, limit, (r) => ({
      id: r.id,
      category: r.category,
      action: r.action,
      actor: r.actorId ? { id: r.actorId, fullName: r.actorName ?? '' } : null,
      entityType: r.entityType,
      entityId: r.entityId,
      metadata: r.metadata as Record<string, unknown>,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
