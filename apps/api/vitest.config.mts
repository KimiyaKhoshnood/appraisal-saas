import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC (not esbuild) so decorator metadata is emitted: Nest's DI depends on it.
const plugins = [swc.vite({ module: { type: 'es6' } })];

export default defineConfig({
  plugins,
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**', 'src/main.ts', 'src/**/index.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
      // NF-13: the isolation-critical modules must stay above 80 % (measured: 90–99 %).
      thresholds: {
        lines: 85,
        branches: 72,
        'src/core/**': { lines: 85, branches: 75 },
        'src/modules/iam/**': { lines: 80 },
        'src/modules/configuration/**': { lines: 80 },
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['test/unit/**/*.spec.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.spec.ts', 'test/e2e/**/*.spec.ts'],
          environment: 'node',
          globalSetup: ['test/support/global-setup.ts'],
          setupFiles: ['test/support/env.ts'],
          // One database, many suites: run files serially, tests inside a file sequentially.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
