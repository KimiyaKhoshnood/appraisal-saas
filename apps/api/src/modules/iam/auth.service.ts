import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { LoginInput, TokenResponse } from '@appraisal/contracts';
import {
  Database,
  ENV,
  EventBus,
  TenantContext,
  TokenBucketLimiter,
  TokenService,
  TooManyRequestsError,
  UnauthorizedError,
  dummyPasswordHash,
  newOpaqueSecret,
  parseOpaqueToken,
  safeEqualHex,
  sha256,
  verifyPassword,
  type Env,
} from '../../core';

export interface IssuedSession extends TokenResponse {
  /** `<id>.<secret>`; goes into an httpOnly cookie, never into a response body. */
  refreshToken: string;
  refreshExpiresAt: Date;
}

const INVALID_CREDENTIALS = () => new UnauthorizedError('INVALID_CREDENTIALS', 'Invalid email or password');

/**
 * Tenant login (AU-01/AU-02). The tenant comes from the sub-domain (TenantGuard, host mode); the
 * user is looked up *inside* that tenant under RLS: there is no global user table to search.
 */
@Injectable()
export class AuthService {
  // T13: 5 attempts per 15 minutes per (tenant, ip, email); 30 per (tenant, ip).
  private readonly perAccount = new TokenBucketLimiter(5, 5 / 900);
  private readonly perIp = new TokenBucketLimiter(30, 30 / 900);

  constructor(
    private readonly db: Database,
    private readonly tokens: TokenService,
    private readonly events: EventBus,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async login(input: LoginInput): Promise<IssuedSession> {
    const store = TenantContext.current()!;
    const tenantId = TenantContext.requireTenantId();
    const waitAccount = this.perAccount.take(`${tenantId}:${store.ip}:${input.email}`);
    const waitIp = this.perIp.take(`${tenantId}:${store.ip}`);
    if (waitAccount || waitIp) {
      await this.events.publishSecurity({ type: 'security.login_throttled', metadata: { ip: store.ip } });
      throw new TooManyRequestsError(Math.max(waitAccount, waitIp));
    }

    const user = await this.db.client.user.findUnique({ where: { tenantId_email: { tenantId, email: input.email } } });
    // Always run argon2 so response time does not reveal whether the email exists.
    const ok = await verifyPassword(user?.passwordHash ?? (await dummyPasswordHash()), input.password);
    if (!user || !ok || !user.active) {
      await this.events.publishSecurity({
        type: 'security.login_failed',
        ...(user ? { entityType: 'user', entityId: user.id } : {}),
        metadata: { reason: !user ? 'unknown_account' : !ok ? 'bad_password' : 'inactive' },
      });
      throw INVALID_CREDENTIALS();
    }

    this.perAccount.reset(`${tenantId}:${store.ip}:${input.email}`);
    store.actor = { type: 'USER', id: user.id, name: user.fullName };
    return this.db.transaction(async () => {
      const session = await this.issue(user.id, randomUUID());
      await this.events.publish({ type: 'auth.login', category: 'SECURITY', entityType: 'user', entityId: user.id });
      return session;
    });
  }

  /**
   * Rotation with reuse detection (NF-04): every refresh consumes the token and issues a new one
   * in the same family. Presenting an already-consumed token means it was copied: the whole
   * family is revoked and the event is recorded.
   */
  async refresh(raw: string | undefined): Promise<IssuedSession> {
    const parsed = parseOpaqueToken(raw);
    if (!parsed) throw new UnauthorizedError('INVALID_REFRESH', 'Session expired, please sign in again');

    const outcome = await this.db.transaction(async (tx) => {
      // Row lock: two concurrent refreshes with the same token cannot both succeed.
      const rows = await tx.$queryRaw<
        { id: string; user_id: string; family_id: string; token_hash: string; expires_at: Date; revoked_at: Date | null }[]
      >`SELECT id, user_id, family_id, token_hash, expires_at, revoked_at
          FROM refresh_token WHERE id = ${parsed.id}::uuid FOR UPDATE`;
      const row = rows[0];
      if (!row || !safeEqualHex(row.token_hash, sha256(parsed.secret))) return { kind: 'invalid' as const };
      if (row.revoked_at) {
        await tx.refreshToken.updateMany({
          where: { familyId: row.family_id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return { kind: 'reuse' as const, userId: row.user_id, familyId: row.family_id };
      }
      if (row.expires_at <= new Date()) return { kind: 'invalid' as const };

      const user = await tx.user.findUnique({ where: { id: row.user_id }, select: { active: true, fullName: true } });
      if (!user?.active) return { kind: 'invalid' as const };

      const store = TenantContext.current()!;
      store.actor = { type: 'USER', id: row.user_id, name: user.fullName };
      const session = await this.issue(row.user_id, row.family_id, row.id);
      return { kind: 'ok' as const, session };
    });

    if (outcome.kind === 'ok') return outcome.session;
    if (outcome.kind === 'reuse') {
      await this.events.publishSecurity({
        type: 'security.refresh_token_reuse',
        entityType: 'user',
        entityId: outcome.userId,
        metadata: { familyId: outcome.familyId },
      });
    }
    throw new UnauthorizedError('INVALID_REFRESH', 'Session expired, please sign in again');
  }

  /** AU-02: logout ends the whole session family, not just the current token. */
  async logout(raw: string | undefined): Promise<void> {
    const parsed = parseOpaqueToken(raw);
    if (!parsed) return;
    await this.db.transaction(async (tx) => {
      const token = await tx.refreshToken.findUnique({ where: { id: parsed.id } });
      if (!token || !safeEqualHex(token.tokenHash, sha256(parsed.secret))) return;
      await tx.refreshToken.updateMany({ where: { familyId: token.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      TenantContext.current()!.actor = { type: 'USER', id: token.userId, name: null };
      await this.events.publish({ type: 'auth.logout', category: 'SECURITY', entityType: 'user', entityId: token.userId });
    });
  }

  private async issue(userId: string, familyId: string, replaces?: string): Promise<IssuedSession> {
    const tenantId = TenantContext.requireTenantId();
    const { secret, hash } = newOpaqueSecret();
    const refreshExpiresAt = new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    const created = await this.db.client.refreshToken.create({
      data: { tenantId, userId, familyId, tokenHash: hash, expiresAt: refreshExpiresAt },
      select: { id: true },
    });
    if (replaces) {
      await this.db.client.refreshToken.update({
        where: { id: replaces },
        data: { revokedAt: new Date(), replacedById: created.id },
      });
    }
    const accessToken = await this.tokens.signTenant({ sub: userId, tid: tenantId });
    return {
      accessToken,
      expiresIn: this.tokens.accessTtlSeconds,
      refreshToken: `${created.id}.${secret}`,
      refreshExpiresAt,
    };
  }
}
