# ADR-010: pnpm monorepo with a shared contracts package

- Status: Accepted
- Date: 2026-10-07

## Decision
One pnpm workspace: `apps/api`, `apps/web`, `packages/contracts`. The contracts package holds the
Zod schemas, permission/feature/plan catalogs and the policy resolution logic. The API validates
requests with them (strict: unknown keys rejected), generates OpenAPI 3.1 from them
(`/api/openapi.json`, `/api/docs`), and the web app uses the same types and pure helpers (e.g.
contrast ratio for live feedback). One definition, so documentation and behaviour cannot drift.

pnpm 11 runs no dependency install scripts except an explicit allow-list (`allowBuilds`), a
supply-chain hardening default.

## Alternatives
Separate repositories with a generated client: more release ceremony for one developer, and
schemas would drift.

## Consequences
A shared build step (contracts are built with tsup to ESM + CJS; the web app consumes the source
through a Vite alias).

## Verification
`pnpm typecheck` across all packages; OpenAPI assertions in `platform.e2e.spec.ts`.
