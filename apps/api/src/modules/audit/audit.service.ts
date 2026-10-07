import { Injectable, OnModuleInit } from '@nestjs/common';
import type { AuditEntryView, AuditQuery, Page } from '@appraisal/contracts';
import { Database, EventBus, TenantContext, keysetArgs, toPage, type DomainEvent } from '../../core';
import type { Prisma } from '../../generated/prisma/client';

const FORBIDDEN_METADATA_KEYS = /^(password|passwordHash|token|secret|score|scores|comment|comments)$/i;

/** Drops anything that looks like sensitive content before it is persisted (NF-06). */
export function sanitizeMetadata(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (FORBIDDEN_METADATA_KEYS.test(k)) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? sanitizeMetadata(v as Record<string, unknown>) : v;
  }
  return out;
}

/**
 * audit depends on nothing but tenancy-core and everything depends on it, through events
 * (ADR-009). The handler writes with `db.client`, which is the publisher's transaction when
 * there is one: change and audit record commit together.
 */
@Injectable()
export class AuditService implements OnModuleInit {
  constructor(
    private readonly db: Database,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.events.subscribe((event) => this.record(event));
  }

  async record(event: DomainEvent): Promise<void> {
    const store = TenantContext.current();
    const tenantId = store?.tenantId;
    if (!tenantId) return; // platform-level events are recorded by the platform module
    await this.db.client.auditLog.create({
      data: {
        tenantId,
        category: event.category,
        action: event.type,
        actorType: store.actor.type,
        actorId: store.actor.id,
        actorName: store.actor.name,
        entityType: event.entityType ?? null,
        entityId: event.entityId ?? null,
        metadata: sanitizeMetadata(event.metadata) as Prisma.InputJsonValue,
        requestId: store.requestId,
        ip: store.ip,
      },
    });
  }

  async search(q: AuditQuery): Promise<Page<AuditEntryView>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.category ? { category: q.category } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.from || q.to
        ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
        : {}),
    };
    const rows = await this.db.client.auditLog.findMany({ where, ...keysetArgs(q.limit, q.cursor) });
    return toPage(rows, q.limit, (r) => ({
      id: r.id,
      category: r.category as AuditEntryView['category'],
      action: r.action,
      actor: r.actorId ? { id: r.actorId, fullName: r.actorName ?? '(unknown)' } : null,
      entityType: r.entityType,
      entityId: r.entityId,
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
      requestId: r.requestId,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
