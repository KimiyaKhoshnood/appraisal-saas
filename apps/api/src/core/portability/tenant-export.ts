import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { Database, type Db } from '../database/database.service';
import { TenantContext } from '../context/request-context';
import { BusinessRuleError } from '../errors/app-errors';

/**
 * Tenant data portability (GDPR art. 20): export (ADR-013) and restore into a new tenant
 * (ADR-016). Every module declares the tables it owns and the columns that must never leave the
 * system; core owns no table and only runs the generic mechanism (ADR-001).
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
  /**
   * Restore only: fills what the export left out (an omitted NOT NULL column) before the row is
   * inserted. Receives the archived row, returns the row to insert.
   */
  importRow?: (row: Record<string, unknown>) => Record<string, unknown>;
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

/** What a restore needs from an archive (the rest of the file is informative). */
export interface ImportArchive {
  tenantId: string;
  manifest: ExportManifestEntry[];
  data: Record<string, Record<string, unknown>[]>;
}

export interface ImportReport {
  sections: number;
  rows: number;
  /** Primary keys re-issued: every one gets a new UUIDv7, every reference follows. */
  remappedIds: number;
  sourceTenantId: string;
  manifestSha256: string;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A row whose tenant differs from the exporting tenant: RLS failed. Never returned to a client. */
export class ExportIsolationError extends Error {
  constructor(table: string) {
    super(`export of ${table} returned a row of another tenant`);
    this.name = 'ExportIsolationError';
  }
}

/** A well-formed archive that cannot be restored as is: modified, incomplete or mixed. */
export class ImportRejectedError extends BusinessRuleError {}

const sha256Of = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Replaces every string found in `map`, at any depth (identifiers also live in JSON metadata). */
function remap(value: unknown, map: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => remap(v, map));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v, map)]));
  return value;
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
          manifest.push({ section: `${s.module}.${s.table}`, rows: plain.length, sha256: sha256Of(plain) });
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

  /**
   * Restores an archive into the **current** tenant (normally one created a moment earlier in the
   * same transaction). Nothing in the file is trusted: every manifest digest must match its data,
   * every row must belong to the archive's tenant, every registered section must be present and
   * no omitted column may reappear. Every primary key gets a new UUIDv7 and every reference
   * follows it (columns and nested JSON alike), so the source tenant can keep running next to its
   * copy. Tables are filled in foreign-key order read from the catalog, and every insert passes
   * the RLS `WITH CHECK` of the current tenant: the database refuses a row for any other tenant.
   */
  async importIntoCurrentTenant(archive: ImportArchive): Promise<ImportReport> {
    const tenantId = TenantContext.requireTenantId();
    const sections = new Map(this.registered().map((s) => [s.table, s]));
    this.verifyArchive(archive, sections);

    return this.db.transaction(async (tx) => {
      const oldIds = [
        ...new Set(
          Object.values(archive.data).flatMap((rows) => rows.map((r) => r['id']).filter((v): v is string => typeof v === 'string' && UUID.test(v))),
        ),
      ];
      const fresh = oldIds.length ? await tx.$queryRaw<{ id: string }[]>`SELECT uuidv7()::text AS id FROM generate_series(1, ${oldIds.length}::int)` : [];
      const map = new Map<string, string>(oldIds.map((id, i) => [id, fresh[i]!.id]));
      map.set(archive.tenantId, tenantId);

      let rows = 0;
      for (const table of await this.insertOrder(tx, [...sections.keys()])) {
        const section = sections.get(table)!;
        const prepared = (archive.data[table] ?? []).map((r) => remap(section.importRow ? section.importRow(r) : r, map));
        if (!prepared.length) continue;
        // Set-based: PostgreSQL maps the JSON keys to the table's typed columns.
        await tx.$executeRawUnsafe(`INSERT INTO "${table}" SELECT * FROM jsonb_populate_recordset(NULL::"${table}", $1::jsonb)`, JSON.stringify(prepared));
        rows += prepared.length;
      }
      return { sections: archive.manifest.length, rows, remappedIds: oldIds.length, sourceTenantId: archive.tenantId, manifestSha256: sha256Of(archive.manifest) };
    });
  }

  private verifyArchive(archive: ImportArchive, sections: ReadonlyMap<string, ExportSection>): void {
    const errors: { path: string; message: string }[] = [];
    const listed = new Set<string>();
    for (const m of archive.manifest) {
      const table = m.section.split('.')[1] ?? '';
      listed.add(table);
      const rows = archive.data[table];
      if (!sections.has(table)) errors.push({ path: `manifest.${m.section}`, message: 'Unknown section' });
      else if (!rows) errors.push({ path: `data.${table}`, message: 'Listed in the manifest but missing' });
      else if (rows.length !== m.rows || sha256Of(rows) !== m.sha256) errors.push({ path: `data.${table}`, message: 'Does not match the manifest digest' });
    }
    for (const table of sections.keys()) if (!listed.has(table)) errors.push({ path: 'manifest', message: `Section ${table} is missing` });
    for (const table of Object.keys(archive.data)) if (!listed.has(table)) errors.push({ path: `data.${table}`, message: 'Not covered by the manifest' });
    if (errors.length) throw new ImportRejectedError('ARCHIVE_INVALID', 'The archive is incomplete or was modified after export', errors.slice(0, 20));

    for (const [table, rows] of Object.entries(archive.data)) {
      if (rows.some((r) => r['tenant_id'] !== archive.tenantId)) {
        throw new ImportRejectedError('ARCHIVE_MIXED_TENANTS', `Section ${table} contains rows of more than one tenant`);
      }
      const reappeared = (sections.get(table)!.omit ?? []).filter((c) => rows.some((r) => c in r));
      if (reappeared.length) throw new ImportRejectedError('ARCHIVE_INVALID', `Section ${table} carries columns that are never exported: ${reappeared.join(', ')}`);
    }
  }

  /** Topological order of the given tables over their foreign keys (Kahn's algorithm). */
  private async insertOrder(tx: Db, tables: string[]): Promise<string[]> {
    const edges = await tx.$queryRaw<{ child: string; parent: string }[]>`
      SELECT c.relname AS child, p.relname AS parent
        FROM pg_constraint k
        JOIN pg_class c ON c.oid = k.conrelid
        JOIN pg_class p ON p.oid = k.confrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE k.contype = 'f' AND n.nspname = current_schema()`;
    const parents = new Map(tables.map((t) => [t, new Set<string>()]));
    for (const e of edges) if (parents.has(e.child) && parents.has(e.parent) && e.child !== e.parent) parents.get(e.child)!.add(e.parent);
    const order: string[] = [];
    const ready = tables.filter((t) => parents.get(t)!.size === 0).sort();
    while (ready.length) {
      const t = ready.shift()!;
      order.push(t);
      for (const [child, ps] of parents) if (ps.delete(t) && ps.size === 0) ready.push(child);
    }
    if (order.length !== tables.length) throw new Error('foreign-key cycle between exported tables');
    return order;
  }
}
