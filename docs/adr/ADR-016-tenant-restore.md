# ADR-016: Restore an export into a new tenant, verified and re-keyed

- Status: Accepted
- Date: 2026-10-14

## Problem
ADR-013 made an organisation's data exportable; without a way back, the export is a dead end.
Three situations need the way back: moving a heavy tenant to its own database (the growth path
experiment E4 points to), recovering an organisation from a backup it holds itself, and making
a sandbox copy. The archive is a file that left the system, so nothing in it can be trusted, and
the source tenant may still exist in the same database: primary keys are global.

## Decision
- **An operator action that creates a new tenant.** `POST /api/platform/tenants/import` takes the
  archive, a new name/slug/plan and one administrator of the archive. Everything happens in one
  transaction in the new tenant's context: tenant row, data, admin password, `ACTIVE`, or nothing.
  The response carries counts and digests only; the console reads the file locally just to show
  the manifest (section names, row counts, checksums), never content.
- **Verify before writing.** Every manifest digest must match its section, every registered
  section must be present and nothing else, every row must carry the archive's tenant id, and
  columns that are never exported (`password_hash`) must not reappear. A re-signed manifest does
  not help an attacker: rows of another tenant or smuggled columns are refused on their own.
- **Re-key everything.** Each primary key gets a new UUIDv7, and every occurrence of it follows,
  in columns and inside JSON (audit metadata holds ids too). The archive's tenant id becomes the
  new tenant id. The copy shares no tenant-owned identifier with its source, which keeps running.
- **Order from the database.** Tables are inserted in foreign-key order computed from
  `pg_constraint` (Kahn's algorithm), so a new table needs no ordering code. Each table is one
  set-based `INSERT … SELECT * FROM jsonb_populate_recordset(…)`: PostgreSQL maps and types columns.
- **The database still guards.** Inserts run as the runtime role under RLS with the new tenant's
  transaction-local setting: the policy's `WITH CHECK` refuses any row for another tenant even if
  the code were wrong.
- **Secrets stay out.** Password hashes were never exported. The module that owns users declares,
  next to its export registration, how a restored row is completed: an unusable password marker.
  The named administrator gets the password given by the operator; everyone else is shown as
  "no password" until an administrator sets one (`POST /api/users/:id/password`, same privilege
  ceiling as other user changes, ends every session of that user, audited as a security event).
  Login treats the marker like an unknown user (dummy argon2 hash, same timing).

## Alternatives
Restoring into the existing tenant (conflicts with live rows; destructive); keeping the original
ids (collides with a source that still exists, and makes copies indistinguishable); `pg_dump` /
`pg_restore` of filtered rows (operator-only, bypasses RLS and the application's audit); exporting
password hashes (moves credentials around in a customer-held file).

## Consequences
A restored organisation is complete but its users must receive new passwords from their admin,
the honest price of never exporting credentials. Archives are loaded in memory (25 MB body limit
on this route only); very large tenants need a streaming format. An archive from a newer schema
version is refused by the per-section column mapping rather than silently partially restored.

## Verification
`restore.e2e.spec.ts`: counts only in the response; the named admin signs in on the new
sub-domain; re-exporting the copy gives the same content under new identifiers; no tenant-owned
identifier shared with the source, which keeps working; other users have no password until an
admin sets one (audited, password never logged); the restore is in the new tenant's audit log;
modified archive, rows of another tenant, smuggled `password_hash`, incomplete archive and a
non-admin e-mail are all refused with nothing left behind; tenant tokens cannot restore. The E1
matrix now also attacks `POST /users/:id/password` with foreign ids (404 in both modes). Manual
check: Acme restored from the console (231 rows, 175 new ids, 319 ms), signed in, Eve's results intact.
