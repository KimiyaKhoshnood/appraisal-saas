# ADR-013: Tenant data export isolated by RLS alone, declared per module

- Status: Accepted
- Date: 2026-10-13

## Problem
An organisation must be able to take its data with it (portability, GDPR art. 20; an exit path
is also a sales argument for a SaaS). The shared schema makes this a filtered export by
definition, which was listed as a known limitation. Two risks: an export that leaks another
tenant's rows, and an export that is inconsistent because it reads tables at different moments.
A third, architectural one: an "export everything" feature tempts code to reach into every
module's tables, breaking module ownership (ADR-001).

## Decision
- **Ownership stays with the modules.** tenancy-core offers a `TenantExportRegistry`; each module
  registers the tables it owns and the columns that must never leave the system (iam omits
  `password_hash` and does not register `refresh_token`). Core runs a generic mechanism and owns
  no table. A new `portability` module exposes `GET /api/tenant/export` and depends on core only.
- **No tenant predicate in the export.** The query is `SELECT to_jsonb(t) - $omit FROM <table>`
  inside a transaction bound to the tenant. Raw SQL skips the Prisma filter (layer 2), so the
  result is isolated by row-level security alone, the strongest layer. Every row is then checked
  again (`tenant_id` must equal the exporting tenant), and a mismatch aborts the export
  ("verify, don't trust").
- **One snapshot.** All tables are read in one `REPEATABLE READ` transaction that is also
  `READ ONLY` for PostgreSQL: the export is consistent across tables and cannot write anything,
  whatever the code tries.
- **Verifiable.** A manifest lists each section with its row count and a SHA-256 of its rows.
- **Controlled and visible.** Permission `data:export` (tenant admins via the system role); each
  export is a `SECURITY` audit event with counts and the manifest digest, never content.
- **Existing tenants get new permissions.** System roles are read-only for tenants, so the catalog
  sync adds new template permissions to them, tenant by tenant under RLS with the transaction-local
  setting (the migrator has no BYPASSRLS either), and bumps the authorisation version.

## Alternatives
`pg_dump` with a row filter (not available per row; operator-only; bypasses the API's audit);
a schema-per-tenant dump (the model rejected in ADR-002); an export service that queries each
module's tables directly (breaks ownership); one query per module service (every module would
re-implement snapshotting and verification).

## Consequences
The export is built in memory, so it suits organisations of thousands of rows, not millions;
streaming NDJSON is the growth path. Restore into a fresh tenant is not implemented: the format
keeps original identifiers and the manifest makes a future importer verifiable.

## Verification
`portability.e2e.spec.ts`: manifest digests match the content; every row belongs to the
exporting tenant and no tenant-owned identifier of another tenant appears; no password hash or
refresh token; **every RLS table is exported or excluded on purpose** (a new table fails the test
until someone decides); 403 for manager and employee; audited; the read-only transaction rejects
an `UPDATE`; a permission removed from an existing tenant is restored by the catalog sync, which
is idempotent.
