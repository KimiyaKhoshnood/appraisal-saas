import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { Database } from '../database/database.service';
import { TenantContext } from '../context/request-context';

/**
 * Tenant data portability (GDPR art. 20, "Per-tenant restore requires a filtered export" in the
 * known limitations). Every module declares the tables it owns and the columns that must never
 * leave the system; core owns no table and only runs the generic mechanism (ADR-001).
 *
 * The export query has **no tenant predicate**: `SELECT … FROM <table>` inside a transaction bound
 * to the tenant. Raw SQL skips the Prisma filter (layer 2), so the result is isolated by
 * PostgreSQL row-level security alone (layer 3), and every row is checked again afterwards.
 */
export interface ExportSection {
  /** Owning module, for the manifest. */
  module: string;
  table: string;
  /** Columns removed from every row (secrets such as password hashes). */
  omit?: string[];
}

export interface ExportManifestEntry {
  section: string;
  rows: number;
  sha256: string;
}

export interface TenantExport {
  format: 'appraisal-tenant-export';
  version: 1;
  exportedAt: string;
  tenantId: string;
  snapshot: { isolation: 'REPEATABLE READ'; readOnly: true };
  manifest: ExportManifestEntry[];
  data: Record<string, unknown[]>;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** A row whose tenant differs from the exporting tenant: RLS failed. Never returned to a client. */
export class ExportIsolationError extends Error {
  constructor(table: string) {
    super(`export of ${table} returned a row of another tenant`);
    this.name = 'ExportIsolationError';
  }
}

@Injectable()
export class TenantExportRegistry {
  private readonly logger = new Logger(TenantExportRegistry.name);
  private readonly sections = new Map<string, ExportSection>();

  constructor(private readonly db: Database) {}

  register(section: ExportSection): void {
    for (const id of [section.table, ...(section.omit ?? [])]) {
      if (!IDENTIFIER.test(id)) throw new Error(`invalid identifier in export section: ${id}`);
    }
    if (this.sections.has(section.table)) throw new Error(`table ${section.table} registered twice for export`);
    this.sections.set(section.table, section);
  }

  registered(): ExportSection[] {
    return [...this.sections.values()].sort((a, b) => a.module.localeCompare(b.module) || a.table.localeCompare(b.table));
  }

  /** Builds the export of the current tenant from one consistent, read-only snapshot. */
  async exportCurrentTenant(): Promise<TenantExport> {
    const tenantId = TenantContext.requireTenantId();
    const sections = this.registered();
    const data: Record<string, unknown[]> = {};
    const manifest: ExportManifestEntry[] = [];

    await this.db.transaction(
      async (tx) => {
        for (const s of sections) {
          // Identifiers are validated at registration; values are bound parameters.
          const rows = await tx.$queryRawUnsafe<{ row: Record<string, unknown> }[]>(
            `SELECT to_jsonb(t) - $1::text[] AS row FROM "${s.table}" t ORDER BY 1`,
            s.omit ?? [],
          );
          const plain = rows.map((r) => r.row);
          // Defence in depth: "verify, don't trust" even the database policy.
          if (plain.some((r) => r['tenant_id'] !== tenantId)) {
            this.logger.error({ table: s.table }, 'tenant export crossed a tenant boundary');
            throw new ExportIsolationError(s.table);
          }
          data[s.table] = plain;
          manifest.push({
            section: `${s.module}.${s.table}`,
            rows: plain.length,
            sha256: createHash('sha256').update(JSON.stringify(plain)).digest('hex'),
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, readOnly: true, timeoutMs: 60_000 },
    );

    return {
      format: 'appraisal-tenant-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      tenantId,
      snapshot: { isolation: 'REPEATABLE READ', readOnly: true },
      manifest,
      data,
    };
  }
}
