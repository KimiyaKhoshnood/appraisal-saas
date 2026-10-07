import { z } from 'zod';
import { uuid } from './common.js';

export const AUDIT_CATEGORIES = ['CHANGE', 'SECURITY'] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const auditQuerySchema = z
  .object({
    category: z.enum(AUDIT_CATEGORIES).optional(),
    action: z.string().max(80).optional(),
    actorId: uuid.optional(),
    entityType: z.string().max(60).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: uuid.optional(),
  })
  .strict();
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export interface AuditEntryView {
  id: string;
  category: AuditCategory;
  action: string;
  actor: { id: string; fullName: string } | null;
  entityType: string | null;
  entityId: string | null;
  /** Keys and identifiers only, never scores or comments (NF-06). */
  metadata: Record<string, unknown>;
  requestId: string | null;
  createdAt: string;
}
