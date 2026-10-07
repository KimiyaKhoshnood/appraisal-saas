import { CrossTenantWriteError, TENANT_MODELS, scopeArgs } from '../../src/core';

const T = '01960000-0000-7000-8000-00000000000a';
const OTHER = '01960000-0000-7000-8000-00000000000b';

describe('tenant scoping (isolation layer 2)', () => {
  it.each(['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy', 'deleteMany'])(
    '%s wraps the caller predicate in AND with the tenant',
    (op) => {
      expect(scopeArgs('User', op, { where: { email: 'x' } }, T)).toEqual({ where: { AND: [{ email: 'x' }, { tenantId: T }] } });
      expect(scopeArgs('User', op, undefined, T)).toEqual({ where: { tenantId: T } });
    },
  );

  it('a caller asking for another tenant matches nothing (AND, not overwrite)', () => {
    const args = scopeArgs('User', 'findMany', { where: { tenantId: OTHER } }, T);
    expect(args).toEqual({ where: { AND: [{ tenantId: OTHER }, { tenantId: T }] } });
  });

  it.each(['findUnique', 'findUniqueOrThrow', 'update', 'delete'])('%s adds tenantId to the unique where', (op) => {
    expect(scopeArgs('User', op, { where: { id: 'u1' } }, T)).toEqual({ where: { id: 'u1', tenantId: T } });
  });

  it('refuses a unique where for another tenant', () => {
    expect(() => scopeArgs('User', 'update', { where: { id: 'u1', tenantId: OTHER } }, T)).toThrow(CrossTenantWriteError);
  });

  it('stamps creates and refuses creates for another tenant', () => {
    expect(scopeArgs('Department', 'create', { data: { name: 'x' } }, T)).toEqual({ data: { name: 'x', tenantId: T } });
    expect(scopeArgs('Department', 'createMany', { data: [{ name: 'a' }, { name: 'b', tenantId: T }] }, T)).toEqual({
      data: [
        { name: 'a', tenantId: T },
        { name: 'b', tenantId: T },
      ],
    });
    expect(() => scopeArgs('Department', 'create', { data: { name: 'x', tenantId: OTHER } }, T)).toThrow(CrossTenantWriteError);
  });

  it('upsert scopes the where, stamps the create and forbids moving a row via update', () => {
    expect(scopeArgs('TenantFeature', 'upsert', { where: { k: 1 }, create: { a: 1 }, update: { b: 2 } }, T)).toEqual({
      where: { k: 1, tenantId: T },
      create: { a: 1, tenantId: T },
      update: { b: 2 },
    });
    expect(() => scopeArgs('TenantFeature', 'upsert', { where: {}, create: {}, update: { tenantId: OTHER } }, T)).toThrow(
      CrossTenantWriteError,
    );
  });

  it('updateMany cannot re-home rows', () => {
    expect(() => scopeArgs('User', 'updateMany', { where: {}, data: { tenantId: OTHER } }, T)).toThrow(CrossTenantWriteError);
  });

  it('fails closed on an operation it does not know', () => {
    expect(() => scopeArgs('User', 'someFutureOperation', {}, T)).toThrow(/does not support/);
  });

  it('covers exactly the tenant-scoped models (platform tables excluded)', () => {
    expect(TENANT_MODELS.has('Tenant')).toBe(false);
    expect(TENANT_MODELS.has('PlatformAdmin')).toBe(false);
    expect(TENANT_MODELS.has('AuditLog')).toBe(true);
    expect(TENANT_MODELS.size).toBe(17);
  });
});
