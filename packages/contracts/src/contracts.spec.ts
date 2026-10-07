import { describe, expect, it } from 'vitest';
import {
  PLATFORM_DEFAULT_POLICY,
  brandingSchema,
  checkOverrideAgainstPlan,
  contrastRatio,
  createTenantSchema,
  replaceCompetenciesSchema,
  resolveEvaluationPolicy,
  slugSchema,
} from './index.js';

describe('branding', () => {
  const ok = { appName: 'Acme', logoUrl: null, primaryColor: '#1D4ED8', secondaryColor: '#0f766e', locale: 'en' as const };

  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it('normalises colours and rejects unreadable ones', () => {
    expect(brandingSchema.parse(ok).primaryColor).toBe('#1d4ed8');
    const res = brandingSchema.safeParse({ ...ok, secondaryColor: '#fde047' });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path).toEqual(['secondaryColor']);
  });

  it('accepts only http(s) logo URLs and no extra keys', () => {
    expect(brandingSchema.safeParse({ ...ok, logoUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(brandingSchema.safeParse({ ...ok, logoUrl: 'https://cdn.example.com/l.svg' }).success).toBe(true);
    expect(brandingSchema.safeParse({ ...ok, tenantId: 'x' }).success).toBe(false);
  });
});

describe('slugs', () => {
  it.each(['acme', 'acme-2', 'a1b'])('accepts %s', (s) => expect(slugSchema.safeParse(s).success).toBe(true));
  it.each(['ab', 'admin', 'www', '-acme', 'acme-', 'ac--me', 'ac_me', 'a'.repeat(41)])('rejects %s', (s) =>
    expect(slugSchema.safeParse(s).success).toBe(false),
  );
  it('lower-cases input', () => expect(slugSchema.parse('Acme')).toBe('acme'));
});

describe('layered evaluation policy', () => {
  it('falls back to platform defaults', () => {
    expect(resolveEvaluationPolicy({}, 'ENTERPRISE')).toEqual(PLATFORM_DEFAULT_POLICY);
  });

  it('tenant override wins within plan limits', () => {
    expect(resolveEvaluationPolicy({ approvalRequired: true, approvalStrategy: 'TWO_STAGE' }, 'BUSINESS')).toMatchObject({
      approvalRequired: true,
      approvalStrategy: 'TWO_STAGE',
    });
  });

  it('a downgraded plan clamps instead of failing a running tenant', () => {
    const p = resolveEvaluationPolicy({ approvalStrategy: 'TWO_STAGE', scale: { min: 1, max: 10 } }, 'STARTER');
    expect(p.approvalStrategy).toBe('SINGLE');
    expect(p.scale).toEqual({ min: 1, max: 5 });
  });

  it('reports precise plan violations for writes', () => {
    expect(checkOverrideAgainstPlan({ approvalStrategy: 'TWO_STAGE', scale: { min: 1, max: 10 } }, 'STARTER').map((v) => v.path)).toEqual([
      'approvalStrategy',
      'scale.max',
    ]);
    expect(checkOverrideAgainstPlan({ approvalStrategy: 'TWO_STAGE' }, 'ENTERPRISE')).toEqual([]);
  });
});

describe('request schemas are strict', () => {
  it('tenant creation rejects unknown keys', () => {
    const base = { name: 'Acme', slug: 'acme', plan: 'STARTER', admin: { email: 'a@a.test', fullName: 'Aa Bb', password: 'Password-123' } };
    expect(createTenantSchema.safeParse(base).success).toBe(true);
    expect(createTenantSchema.safeParse({ ...base, status: 'ACTIVE' }).success).toBe(false);
  });

  it('competency weights must total 100 with unique names', () => {
    expect(replaceCompetenciesSchema.safeParse({ competencies: [{ name: 'Aa', weight: 50 }, { name: 'Bb', weight: 50 }] }).success).toBe(true);
    expect(replaceCompetenciesSchema.safeParse({ competencies: [{ name: 'Aa', weight: 50 }, { name: 'Bb', weight: 40 }] }).success).toBe(false);
    expect(replaceCompetenciesSchema.safeParse({ competencies: [{ name: 'Aa', weight: 50 }, { name: 'aa', weight: 50 }] }).success).toBe(false);
  });
});
