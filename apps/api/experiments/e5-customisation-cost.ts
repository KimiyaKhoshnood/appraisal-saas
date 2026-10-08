/**
 * E5 (RQ3): what does a new customer requirement cost, by ladder level?
 *
 * Scenario from the architecture document: "a new tenant needs two-stage approval". The project
 * implemented it at level 3 (shared strategy + configuration). This script measures, from the
 * code itself, what that change consists of, and contrasts it with the level-4 alternative
 * (a branch for that tenant) by counting the decision points such a branch must touch. It also
 * measures the alternative scenario named in the document: adding a level-2 parameter
 * (resultVisibility).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { table, writeResult } from './lib';

const ROOT = join(__dirname, '..', '..', '..');

function files(dir: string, ext = /\.(ts|tsx)$/): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (/node_modules|dist|generated|coverage/.test(p)) return [];
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(name) ? [p] : [];
  });
}

function occurrences(pattern: RegExp, scope: string[]): { file: string; lines: number }[] {
  return scope
    .map((f) => ({ file: relative(ROOT, f).split('\\').join('/'), lines: readFileSync(f, 'utf8').split('\n').filter((l) => pattern.test(l)).length }))
    .filter((x) => x.lines > 0);
}

function classLines(file: string, className: string): number {
  const src = readFileSync(file, 'utf8').split('\n');
  const start = src.findIndex((l) => l.includes(`class ${className}`));
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    depth += (src[i]!.match(/\{/g) ?? []).length - (src[i]!.match(/\}/g) ?? []).length;
    if (depth === 0 && i > start) return i - start + 1;
  }
  return 0;
}

const prod = [...files(join(ROOT, 'apps/api/src')), ...files(join(ROOT, 'packages/contracts/src')), ...files(join(ROOT, 'apps/web/src'))].filter(
  (f) => !/\.spec\./.test(f),
);
const tests = [...files(join(ROOT, 'apps/api/test')), ...files(join(ROOT, 'packages/contracts/src'))].filter((f) => /\.spec\./.test(f));

const twoStageProd = occurrences(/TWO_STAGE|TwoStageApproval/, prod);
const twoStageTests = occurrences(/TWO_STAGE|TwoStageApproval/, tests);
const strategyClass = classLines(join(ROOT, 'apps/api/src/modules/evaluation/domain/approval-strategy.ts'), 'TwoStageApproval');

// Decision points a tenant-specific branch would have to duplicate: every place the code asks
// "which approval behaviour applies?" — strategy lookups and approval-state checks.
const decisionPoints = occurrences(/approvalStrategy\(|policy\.approvalRequired|APPROVAL_STATUSES/, prod.filter((f) => /apps[\\/]api/.test(f)));

const visibilityProd = occurrences(/resultVisibility|RESULT_VISIBILITY|MANAGERS_ONLY|AFTER_PUBLISH/, prod);
const visibilityTests = occurrences(/resultVisibility|MANAGERS_ONLY|AFTER_PUBLISH/, tests);

const sum = (xs: { lines: number }[]) => xs.reduce((s, x) => s + x.lines, 0);
const md = `
# E5: cost of customisation by ladder level

Scenario: *a new customer needs two-stage approval* (four-eyes principle).

## Level 3, as implemented: shared strategy selected by configuration

${table(
  ['measure', 'value'],
  [
    ['new strategy class (TwoStageApproval)', `${strategyClass} lines`],
    ['production files mentioning the strategy', `${twoStageProd.length} (${sum(twoStageProd)} lines): ${twoStageProd.map((x) => x.file.replace(/^.*\//, '')).join(', ')}`],
    ['test files exercising it', `${twoStageTests.length} (${sum(twoStageTests)} lines)`],
    ['code paths that branch on the tenant', '0 (lint rule forbids it)'],
    ['tenants that can use it', 'all on BUSINESS/ENTERPRISE plans, by setting `approvalStrategy`'],
    ['deployment needed for the next customer who wants it', 'none (a settings change)'],
  ],
)}

## Level 4, counterfactual: \`if (tenant === 'x')\` branches

The approval behaviour is consulted at **${decisionPoints.reduce((s, x) => s + x.lines, 0)} decision points in ${decisionPoints.length} API files**
(${decisionPoints.map((x) => x.file.replace(/^.*\//, '')).join(', ')}). A tenant branch must be correct at each
of them; every existing test path then has to run for "tenant x" and "everyone else", i.e. the test
matrix doubles for this feature, and doubles again for each further special customer. The next
customer who wants the same behaviour gets a second branch, or a refactoring into what level 3
already is. The project's lint rule (\`no-restricted-syntax\`, see \`eslint.config.mjs\`) makes this
level a build failure; it caught one such comparison in the seed during development.

## Alternative scenario: a new level-2 parameter (resultVisibility)

${table(
  ['measure', 'value'],
  [
    ['production files touched', `${visibilityProd.length} (${sum(visibilityProd)} lines)`],
    ['test files', `${visibilityTests.length} (${sum(visibilityTests)} lines)`],
    ['new test paths', '1 per value (AFTER_PUBLISH, MANAGERS_ONLY)'],
  ],
)}

## Reading (RQ3)

| level | example | change per new customer | maintenance cost |
| --- | --- | --- | --- |
| 0 branding | colours, name, logo | data only | ~0 |
| 1 feature flag | reports on/off | data only | one gate per feature, tested once |
| 2 parameter | scale, visibility | data only after the first implementation | one test path per value |
| 3 strategy | SINGLE / TWO_STAGE approval | data only after the first implementation | one class + its tests, shared by all |
| 4 tenant code | \`if (tenant === 'x')\` | code + deploy for every customer | multiplies test paths; forbidden |

The numbers above are counted from the repository by this script, so they stay true as the code evolves.
`;

writeResult('e5-customisation-cost', { twoStageProd, twoStageTests, strategyClass, decisionPoints, visibilityProd, visibilityTests }, md);
