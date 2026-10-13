/**
 * Module boundaries of the modular monolith (ADR-001, NF-12). A violation fails `pnpm boundaries`
 * and therefore CI. The allowed edges are the "allowed dependency" column of the architecture
 * document (plus organization → iam, see ADR-001).
 */
const ALLOWED = {
  audit: [],
  iam: ['audit'],
  configuration: ['audit'],
  organization: ['iam', 'audit'],
  platform: ['iam', 'configuration', 'audit'],
  evaluation: ['configuration', 'organization', 'audit'],
  reporting: ['evaluation', 'configuration'],
  portability: [],
};

const moduleRules = Object.entries(ALLOWED).map(([mod, allowed]) => ({
  name: `module-${mod}-dependencies`,
  comment: `${mod} may depend on: ${allowed.length ? allowed.join(', ') : 'nothing but tenancy-core'}`,
  severity: 'error',
  from: { path: `^src/modules/${mod}/` },
  to: {
    path: '^src/modules/([^/]+)/',
    pathNot: [`^src/modules/${mod}/`, ...allowed.map((m) => `^src/modules/${m}/`)],
  },
}));

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'The module graph must stay acyclic.',
      severity: 'error',
      from: { path: '^src/' },
      to: { circular: true },
    },
    {
      name: 'core-is-a-leaf',
      comment: 'tenancy-core is a shared kernel: it never imports a domain module or the composition root.',
      severity: 'error',
      from: { path: '^src/core/' },
      to: { path: '^src/(modules|app)/' },
    },
    {
      name: 'modules-not-into-app',
      comment: 'Only the composition root (src/app) knows every module.',
      severity: 'error',
      from: { path: '^src/modules/' },
      to: { path: '^src/app/' },
    },
    {
      name: 'public-api-only',
      comment: "Another module is reached through its index.ts only (its public API), never its internals.",
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: { path: '^src/modules/[^/]+/.+', pathNot: ['^src/modules/$1/', '^src/modules/[^/]+/index\\.ts$'] },
    },
    {
      name: 'core-public-api-only',
      comment: 'Modules import tenancy-core through src/core/index.ts.',
      severity: 'error',
      from: { path: '^src/(modules|app)/' },
      to: { path: '^src/core/.+', pathNot: ['^src/core/index\\.ts$'] },
    },
    ...moduleRules,
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^src/generated/' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default'] },
  },
};
