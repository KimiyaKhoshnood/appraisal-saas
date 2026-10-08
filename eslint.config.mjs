// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Level 4 of the customisation ladder ("code for one tenant") is forbidden, and the build
 * enforces it: comparing a tenant slug / id with a literal is a lint error everywhere except
 * tenancy-core. Customer differences must be configuration (TenantSettings) or a strategy.
 */
const TENANT_KEYS = '/^(slug|tenantId|tenantSlug|tid)$/';
const tenantSpecificCode = [
  {
    selector: `BinaryExpression[operator=/^[!=]==?$/][left.property.name=${TENANT_KEYS}][right.type='Literal']`,
    message: 'Tenant-specific code is forbidden (customisation level 4). Make it configuration or a strategy.',
  },
  {
    selector: `BinaryExpression[operator=/^[!=]==?$/][right.property.name=${TENANT_KEYS}][left.type='Literal']`,
    message: 'Tenant-specific code is forbidden (customisation level 4). Make it configuration or a strategy.',
  },
  {
    selector: `BinaryExpression[operator=/^[!=]==?$/][left.name=${TENANT_KEYS}][right.type='Literal']`,
    message: 'Tenant-specific code is forbidden (customisation level 4). Make it configuration or a strategy.',
  },
  {
    selector: `SwitchStatement[discriminant.property.name=${TENANT_KEYS}]`,
    message: 'Switching on a tenant is tenant-specific code (customisation level 4).',
  },
];

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'apps/api/src/generated/**', '**/*.cjs', '**/vite-env.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'no-restricted-syntax': ['error', ...tenantSpecificCode],
    },
  },
  {
    // NestJS DI reads constructor parameter types at runtime: they must stay value imports.
    files: ['apps/api/src/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  {
    files: ['apps/api/src/core/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['**/scripts/**', '**/prisma/**', '**/experiments/**', '**/test/**', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
);
