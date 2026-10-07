import { Injectable, Logger } from '@nestjs/common';
import type { AuditCategory } from '@appraisal/contracts';

/**
 * In-process, synchronous domain events (ADR-009). A module publishes inside its transaction and
 * every handler runs on the same connection, so the audit record commits or rolls back together
 * with the change it describes. No broker: nothing outside the process consumes these.
 */
export interface DomainEvent {
  /** Stable machine name, e.g. `config.branding.updated`, `security.permission_denied`. */
  type: string;
  category: AuditCategory;
  entityType?: string;
  entityId?: string;
  /** Identifiers and changed keys only. Never scores, comments, passwords or tokens (NF-06). */
  metadata?: Record<string, unknown>;
}

export type DomainEventHandler = (event: DomainEvent) => Promise<void>;

@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);
  private readonly handlers: DomainEventHandler[] = [];

  subscribe(handler: DomainEventHandler): void {
    this.handlers.push(handler);
  }

  /** Awaits every handler; a failing handler fails the publisher (and its transaction). */
  async publish(event: DomainEvent): Promise<void> {
    for (const handler of this.handlers) await handler(event);
  }

  /**
   * Security events are recorded best-effort: they are written outside any business
   * transaction (the request is usually being rejected) and must never mask the original error.
   */
  async publishSecurity(event: Omit<DomainEvent, 'category'>): Promise<void> {
    try {
      await this.publish({ ...event, category: 'SECURITY' });
    } catch (err) {
      this.logger.error({ err, event: event.type }, 'failed to record security event');
    }
  }
}
