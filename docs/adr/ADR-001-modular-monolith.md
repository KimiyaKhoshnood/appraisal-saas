# ADR-001: Modular monolith with enforced boundaries

- Status: Accepted
- Date: 2026-10-07

## Problem
N organisations must be served from one code base by a single developer. The three properties the
product depends on most are: one transaction carrying the tenant context, atomic tenant creation,
and an audit record written in the same transaction as the change it describes.

## Decision
One NestJS application (`apps/api`) split into modules by *reason to change*: `platform`, `iam`,
`configuration`, `organization`, `evaluation`, `reporting`, `audit`, plus the shared kernel
`src/core` (tenancy-core). Boundaries are enforced in CI by dependency-cruiser
(`apps/api/.dependency-cruiser.cjs`):

1. another module is reached only through its `index.ts` (public API);
2. a module owns its tables and other modules never query them;
3. allowed edges form a DAG (see the table in the config file); no cycles;
4. cross-cutting writes (audit) travel as in-process domain events inside the same transaction.

`src/app` is the composition root: the only place that imports every module. It binds the core's
ports (`TenantLookup`, `AccessContextLoader`, `PlatformAdminLookup`) to module implementations, so
tenancy-core never imports a domain module (dependency inversion).

**Deviation from phase 1:** the edge `organization → iam` was added. Organization needs display
names and user existence; reading `app_user` itself would break rule 2, so it calls iam's
read-only `UserDirectory`.

## Alternatives
Microservices: every tenant-scoped call would need context propagation per hop, tenant creation
would become a saga and audit would become eventually consistent. Distribution solves none of the
problems of this project and makes all of them harder.

## Consequences
No independent scaling of parts (the whole application scales by replicas, NF-10). Revisit when a
module develops a radically different load or deploy cycle (e.g. heavy reporting), when several
independent teams appear, or when replicating the whole app is no longer enough.

## Verification
`pnpm boundaries` fails the build on any forbidden import (demonstrated with a deliberately illegal
import: three violations reported). The allowed edges are one table in the config file.
