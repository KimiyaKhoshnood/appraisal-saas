# ADR-006: Typed configuration in JSONB, validated by Zod, resolved in layers

- Status: Accepted
- Date: 2026-10-07

## Problem
Customers differ (cycle cadence, rating scale, self-assessment, approval, result visibility,
branding, features). The differences must be data, never code (customisation level 4 is banned).

## Decision
- Each tenant has one `tenant_settings` row holding a **versioned** JSON document
  (`schemaVersion: 1`) validated on every write by the shared Zod schema in `@appraisal/contracts`.
  The same schema provides TypeScript types and drives the admin form.
- The effective policy is computed from three layers: **platform default → plan limits → tenant
  override** (`resolveEvaluationPolicy`). A plan downgrade clamps values instead of failing.
- Features are rows (`tenant_feature`); effective = enabled by the tenant ∩ allowed by the plan.
- The result is cached in-process under `(tenant, config_version, plan)`. `config_version` is
  bumped by every change and read on every request, so all replicas see a change on the next
  request without any invalidation bus or Redis.
- Branding is validated too: hex colours only, and each brand colour must reach 4.5:1 contrast
  with white (WCAG AA). The first implementation checked "best of black or white text", which
  passes for virtually any colour; a test exposed it and the rule was fixed.

## Alternatives
A column per setting (a migration for every new parameter); a rules engine/DSL in tenants' hands
(untestable programming by customers).

## Consequences
Changing the shape of the settings document requires a data migration of existing rows, guided by
`schemaVersion`. A cycle stores a **snapshot** of the effective policy when it is created, so a
policy change never alters a running cycle.

## Verification
`contracts.spec.ts` (layering, plan clamping, contrast), `configuration-rbac.e2e.spec.ts`
(change visible on the next request, plan bounds, audit of changed keys),
`evaluation.e2e.spec.ts` (snapshot semantics).
