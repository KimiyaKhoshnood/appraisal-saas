# E5: cost of customisation by ladder level

Scenario: *a new customer needs two-stage approval* (four-eyes principle).

## Level 3, as implemented: shared strategy selected by configuration

| measure | value |
| --- | --- |
| new strategy class (TwoStageApproval) | 18 lines |
| production files mentioning the strategy | 4 (9 lines): approval-strategy.ts, state-machine.ts, policy.ts, messages.ts |
| test files exercising it | 3 (13 lines) |
| code paths that branch on the tenant | 0 (lint rule forbids it) |
| tenants that can use it | all on BUSINESS/ENTERPRISE plans, by setting `approvalStrategy` |
| deployment needed for the next customer who wants it | none (a settings change) |

## Level 4, counterfactual: `if (tenant === 'x')` branches

The approval behaviour is consulted at **15 decision points in 4 API files**
(cycles.service.ts, approval-strategy.ts, state-machine.ts, evaluations.service.ts). A tenant branch must be correct at each
of them; every existing test path then has to run for "tenant x" and "everyone else", i.e. the test
matrix doubles for this feature, and doubles again for each further special customer. The next
customer who wants the same behaviour gets a second branch, or a refactoring into what level 3
already is. The project's lint rule (`no-restricted-syntax`, see `eslint.config.mjs`) makes this
level a build failure; it caught one such comparison in the seed during development.

## Alternative scenario: a new level-2 parameter (resultVisibility)

| measure | value |
| --- | --- |
| production files touched | 5 (14 lines) |
| test files | 1 (3 lines) |
| new test paths | 1 per value (AFTER_PUBLISH, MANAGERS_ONLY) |

## Reading (RQ3)

| level | example | change per new customer | maintenance cost |
| --- | --- | --- | --- |
| 0 branding | colours, name, logo | data only | ~0 |
| 1 feature flag | reports on/off | data only | one gate per feature, tested once |
| 2 parameter | scale, visibility | data only after the first implementation | one test path per value |
| 3 strategy | SINGLE / TWO_STAGE approval | data only after the first implementation | one class + its tests, shared by all |
| 4 tenant code | `if (tenant === 'x')` | code + deploy for every customer | multiplies test paths; forbidden |

The numbers above are counted from the repository by this script, so they stay true as the code evolves.
