# Appraisal SaaS — multi-tenant performance appraisal

A multi-tenant SaaS for employee performance appraisal, built to demonstrate and **measure** the
architecture of multi-tenancy: many independent organisations served by one code base and one
database, isolated in five layers down to PostgreSQL itself, and differing only by configuration.

- **Modular monolith** — NestJS 11, enforced module boundaries ([ADR-001](docs/adr/ADR-001-modular-monolith.md))
- **Shared schema + Row-Level Security** — PostgreSQL 18, `FORCE ROW LEVEL SECURITY`, composite tenant keys ([ADR-002](docs/adr/ADR-002-shared-schema-rls.md))
- **Tenant = signed JWT claim**, the sub-domain is a hint that must agree ([ADR-003](docs/adr/ADR-003-tenant-identification.md))
- **AsyncLocalStorage + Prisma 7 client extension + transaction-local `set_config`** ([ADR-004](docs/adr/ADR-004-tenant-context-propagation.md))
- **Configuration instead of code** — typed, layered (platform → plan → tenant), versioned ([ADR-006](docs/adr/ADR-006-typed-layered-configuration.md))
- **React 19** front-end, one build for every tenant, branded and localised (incl. Persian RTL) at runtime

> Architecture: [docs/architecture.md](docs/architecture.md) · ADRs: [docs/adr](docs/adr) ·
> Experiments: [docs/experiments](docs/experiments/README.md) · Persian summary for the defence: [docs/report-fa.md](docs/report-fa.md)

## Repository

```
apps/api            NestJS API (modular monolith)
  src/core            tenancy-core: context, database, guards, events, errors (owns no table)
  src/modules/*       platform · iam · configuration · organization · evaluation · reporting · audit
  src/app             composition root (ports → implementations, guard order)
  prisma/             schema, migrations (DDL + RLS/grants), catalog sync, seed
  test/               unit · integration (real PostgreSQL) · e2e · isolation matrix
  experiments/        E2–E6 measurement scripts
apps/web            React + Vite + TanStack Query + Tailwind 4
packages/contracts  Zod schemas, permission/feature/plan catalogs, policy resolution (shared)
docs/               architecture, ADR-001…012, experiment results
```

## Run it locally (native)

Prerequisites: Node ≥ 22.12 (24 recommended), pnpm 11, PostgreSQL 18 (16+ works except for `uuidv7()`).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env        # then set POSTGRES_SUPERUSER_URL and two JWT secrets
pnpm --filter @appraisal/contracts build
pnpm --filter @appraisal/api prisma:generate
pnpm --filter @appraisal/api db:bootstrap     # creates roles appraisal_migrator / app_runtime / appraisal_app and the databases
pnpm db:reset                                 # migrate + catalogs + demo seed (one command, repeatable)
pnpm dev                                      # API on :3000, web on :5173
```

Open (no hosts-file edits needed in Chrome/Firefox/Edge: `*.localhost` resolves to 127.0.0.1):

| URL | What | Accounts (password `Demo-pass-2026`) |
| --- | --- | --- |
| http://localhost:5173 | landing page | — |
| http://acme.localhost:5173 | Acme Robotics — ENTERPRISE, self-assessment + single approval, English | `ada@acme.test` (admin), `max@acme.test` (manager), `eve@acme.test` (employee), `hana@acme.test` (custom "HR reviewer" role) |
| http://globex.localhost:5173 | Globex Logistics — BUSINESS, no self-assessment, no approval, scale 1–10, results hidden from employees, **Persian RTL** | `gita@globex.test` (admin), `kian@globex.test` (manager), `sara@globex.test` |
| http://admin.localhost:5173 | platform console (create/suspend tenants) | `platform@appraisal.test` |
| http://localhost:3000/api/docs | OpenAPI 3.1 (generated from the same Zod schemas that validate requests) | — |

## Run it with Docker

```bash
docker compose up --build
```

Postgres 18, a one-shot job (bootstrap roles → migrate → catalogs → seed), **two API replicas**
behind nginx (stateless backend, NF-10) and the web app on http://acme.localhost:8080.

## Quality gates

```bash
pnpm typecheck        # all packages
pnpm lint             # ESLint, incl. the ban on tenant-specific code (customisation level 4)
pnpm boundaries       # dependency-cruiser: module DAG, public index.ts only, core is a leaf
pnpm test             # contracts + web + API (unit, RLS integration, e2e, isolation matrix)
pnpm --filter @appraisal/api test:cov   # with coverage thresholds (NF-13)
```

Current results (laptop, 2026-10-08): **126 API tests + 21 contracts + 11 web, all green**;
API line coverage 94 %, branches 81 %; 0 lint issues;
0 boundary violations. The CI workflow ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the same
steps against a PostgreSQL 18 service; it has not run yet because nothing has been pushed.

## Requirements traceability

| Req. | Implemented in | Verified by |
| --- | --- | --- |
| AU-01 login on the tenant sub-domain | `iam/auth.service.ts`, `TenantGuard` (host mode) | `auth.e2e.spec.ts` |
| AU-02 refresh rotation, logout | `iam/auth.service.ts` (family revocation on reuse) | `auth.e2e.spec.ts` |
| AU-03 separate platform login | `platform/platform-auth.service.ts` | `auth.e2e.spec.ts`, `platform.e2e.spec.ts` |
| PL-01 atomic tenant creation | `platform/tenants.service.ts` (one transaction in the new tenant's context) | `platform.e2e.spec.ts` (atomicity, < 5 s) |
| PL-02 suspend / reactivate | `tenants.service.ts`, `TenantGuard` | `platform.e2e.spec.ts` |
| PL-03/04/05 list, plans, platform audit | `platform.controller.ts` | `platform.e2e.spec.ts` |
| TA-01/02 users, roles | `iam/users.service.ts` | `configuration-rbac.e2e.spec.ts` |
| TA-03 departments, reporting lines | `organization/` (loop detection) | `configuration-rbac.e2e.spec.ts` |
| TA-04 branding (WCAG) | `configuration/`, `contracts/branding.ts` | `contracts.spec.ts`, e2e |
| TA-05 features within plan | `configuration/` + `FeatureGuard` | `configuration-rbac.e2e.spec.ts` |
| TA-06 evaluation policy | `contracts/policy.ts` (layered) | `contracts.spec.ts`, `evaluation.e2e.spec.ts` |
| TA-07 audit search | `audit/` | several e2e |
| TA-08 custom roles | `iam/roles.service.ts` (feature `customRoles`) | `configuration-rbac.e2e.spec.ts` |
| EV-01…06 cycles, competencies, self/manager, approval, visibility | `evaluation/` (state machine, strategies) | `evaluation.e2e.spec.ts`, `evaluation-domain.spec.ts` |
| EV-07/08 history, team dashboard | `evaluation/` | `evaluation.e2e.spec.ts` |
| RP-01/02/03 reports, CSV, analytics | `reporting/` (feature-gated) | `evaluation.e2e.spec.ts` |
| AD-01/02/03 audit, security events, append-only | `audit/`, migration triggers + grants | `rls.spec.ts`, e2e |
| FE-01/02/03 theming, navigation, states | `apps/web` | `web.spec.ts`, manual demo |
| NF-01 no cross-tenant leak | five layers | E1 matrix (both modes) |
| NF-02 fail-closed RLS | policy with `NULLIF(current_setting)` | `rls.spec.ts` |
| NF-03 / T14 no RLS bypass at runtime | `db-bootstrap.ts`, grants | `rls.spec.ts` |
| NF-04 argon2id, short tokens, rotation | `core/security` | unit + e2e |
| NF-05 strict input | Zod `.strict()` | mass-assignment e2e |
| NF-06 privacy in logs/audit | pino redaction, metadata sanitiser | `logging.spec.ts`, unit |
| NF-07/08/09 performance, overhead, neighbours | indexes, wrapper, limiter, timeout | E6, E3, E4 |
| NF-10 stateless, 2 replicas | compose `replicas: 2` | compose file |
| NF-11 tenant in < 5 s, no restart | onboarding = data | `platform.e2e.spec.ts`, console timer |
| NF-12 module boundaries in CI | dependency-cruiser | `pnpm boundaries` |
| NF-13 coverage | Vitest thresholds | `test:cov` |
| NF-14 JSON logs with tenantId/requestId | `core/logging` | `logging.spec.ts` |
| NF-15 one command | `docker compose up` / `pnpm db:reset` | compose, README |

## Experiments (summary)

| Id | Question | Result (details in [docs/experiments](docs/experiments/README.md)) |
| --- | --- | --- |
| E1 | Is isolation complete? | Every parameterised tenant route answers 404 to foreign ids, **also with the application filter off** (RLS alone); no foreign id in any collection; foreign references rejected; victim unchanged. |
| E2 | Shared schema vs schema-per-tenant | provisioning ≈ 3.5 ms (A) vs ≈ 220 ms (B); one migration ≈ 0.1 s once (A) vs linear in N (1.8 s for 500 empty schemas); B adds 84 relations per tenant (+150 MB catalog at 500) |
| E3 | Cost of RLS and the wrapper | RLS predicate ≈ 0 (folded into the index condition); transaction wrapper ≈ 0.2 ms; ORM ≈ 1.5 ms |
| E4 | Noisy neighbour | light tenant p95: 27 ms alone → 960 ms with a 100× tenant hammering it → 683 ms with the per-tenant rate limit → 298 ms adding `statement_timeout` (3 repetitions). Controls help a lot; full isolation of a heavy tenant needs separate capacity (documented growth path) |
| E5 | Cost of customisation | level 3 strategy: 18-line class, 0 tenant branches, no deploy per customer |
| E6 | Growth and tenant-first indexes | 100 tenants, 3.2 M scores, 1 M audit rows: shipped indexes keep every query ≤ 4 ms p95 (NF-07). Tenant-first is decisive where the tenant is the selective column (audit page: 6–8 vs 104–154 pages, ~1 ms vs 16–24 ms, growing with tenant count); equal where another column is selective; no index → 240 ms |

## Decisions that changed during implementation

Recorded honestly, because they are part of the argument:

- **WCAG rule**: "best of black/white text ≥ 4.5:1" passes for almost every colour; replaced by
  "contrast with white ≥ 4.5:1" for both brand colours after a test exposed it.
- **Lazy Prisma promises escape AsyncLocalStorage scopes**: found by a 200-request concurrency
  test (second transaction opened, pool starved) and again by E3 in `runAs`; both scopes now await
  inside, with regression tests on a one-connection pool.
- **`organization → iam`** dependency added (ADR-001) instead of reading the users table.
- **Internal security review** (independent pass over the code) found no tenant-isolation breach but
  two in-tenant privilege escalations (`user:write` could mint an admin; `role:write` ≈ all
  permissions) and four races/edge cases (admins demoting each other to zero admins, two active
  cycles, a double refresh revoking the session, a malformed token id giving 500). All fixed with a
  grant ceiling, a last-admin invariant under a row lock, a partial unique index, a refresh grace
  window, strict UUID parsing; each has a regression test.
- **E4 findings**: the first rate limiter allowed a whole minute of burst and never fired within a
  test window (burst is now 10 s of budget); statement timeouts surfaced as 500 (now 503 + Retry-After).
- **Prisma `maxWait`** raised from 2 s: bursts that a 10-connection pool absorbs fine were failing.

## Licence

Academic project. All names and data are fictional.
