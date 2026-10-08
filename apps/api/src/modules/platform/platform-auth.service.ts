import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { LoginInput } from '@appraisal/contracts';
import {
  Database,
  ENV,
  EventBus,
  TenantContext,
  TokenBucketLimiter,
  TokenService,
  TooManyRequestsError,
  TtlCache,
  UnauthorizedError,
  dummyPasswordHash,
  newOpaqueSecret,
  parseOpaqueToken,
  safeEqualHex,
  sha256,
  verifyPassword,
  type Env,
  type PlatformAdminLookup,
} from '../../core';

export interface PlatformSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * AU-03: platform admins sign in on admin.<base> with their own table, key and audience.
 * Same rotation/reuse-detection scheme as tenant sessions, on platform tables.
 */
@Injectable()
export class PlatformAuthService implements PlatformAdminLookup {
  private readonly limiter = new TokenBucketLimiter(5, 5 / 900);
  private readonly active = new TtlCache<{ id: string; fullName: string } | null>(5_000, 1_000);

  constructor(
    private readonly db: Database,
    private readonly tokens: TokenService,
    private readonly events: EventBus,
    @Inject(ENV) private readonly env: Env,
  ) {}

  activeAdmin(id: string) {
    return this.active.getOrLoad(id, async () => {
      const a = await this.db.client.platformAdmin.findUnique({ where: { id }, select: { id: true, fullName: true, active: true } });
      return a?.active ? { id: a.id, fullName: a.fullName } : null;
    });
  }

  async login(input: LoginInput): Promise<PlatformSession> {
    const store = TenantContext.current()!;
    const wait = this.limiter.take(`${store.ip}:${input.email}`);
    if (wait) throw new TooManyRequestsError(wait);

    const admin = await this.db.client.platformAdmin.findUnique({ where: { email: input.email } });
    const ok = await verifyPassword(admin?.passwordHash ?? (await dummyPasswordHash()), input.password);
    if (!admin || !ok || !admin.active) {
      store.actor = { type: 'PLATFORM_ADMIN', id: admin?.id ?? null, name: null };
      await this.events.publishSecurity({ type: 'platform.login_failed', metadata: { reason: !admin ? 'unknown_account' : 'bad_credentials' } });
      throw new UnauthorizedError('INVALID_CREDENTIALS', 'Invalid email or password');
    }
    store.actor = { type: 'PLATFORM_ADMIN', id: admin.id, name: admin.fullName };
    return this.db.platformTransaction(async (tx) => {
      await tx.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
      const session = await this.issue(admin.id, randomUUID());
      await this.events.publish({ type: 'platform.login', category: 'SECURITY', entityType: 'platform_admin', entityId: admin.id });
      return session;
    });
  }

  async refresh(raw: string | undefined): Promise<PlatformSession> {
    const parsed = parseOpaqueToken(raw);
    if (!parsed) throw new UnauthorizedError('INVALID_REFRESH', 'Session expired, please sign in again');
    const outcome = await this.db.platformTransaction(async (tx) => {
      const rows = await tx.$queryRaw<
        {
          id: string;
          admin_id: string;
          family_id: string;
          token_hash: string;
          expires_at: Date;
          revoked_at: Date | null;
          replaced_by_id: string | null;
          family_started_at: Date;
        }[]
      >`SELECT t.id, t.admin_id, t.family_id, t.token_hash, t.expires_at, t.revoked_at, t.replaced_by_id,
               (SELECT min(f.created_at) FROM platform_refresh_token f WHERE f.family_id = t.family_id) AS family_started_at
          FROM platform_refresh_token t WHERE t.id = ${parsed.id}::uuid FOR UPDATE OF t`;
      const row = rows[0];
      if (!row || !safeEqualHex(row.token_hash, sha256(parsed.secret))) return 'invalid' as const;
      if (row.revoked_at && row.replaced_by_id && Date.now() - row.revoked_at.getTime() < this.env.REFRESH_REUSE_GRACE_MS) return 'invalid' as const;
      if (Date.now() - row.family_started_at.getTime() > this.env.SESSION_MAX_DAYS * 86_400_000) return 'invalid' as const;
      if (row.revoked_at) {
        await tx.platformRefreshToken.updateMany({ where: { familyId: row.family_id, revokedAt: null }, data: { revokedAt: new Date() } });
        return 'reuse' as const;
      }
      if (row.expires_at <= new Date()) return 'invalid' as const;
      const admin = await this.activeAdmin(row.admin_id);
      if (!admin) return 'invalid' as const;
      TenantContext.current()!.actor = { type: 'PLATFORM_ADMIN', id: admin.id, name: admin.fullName };
      return this.issue(row.admin_id, row.family_id, row.id);
    });
    if (typeof outcome === 'object') return outcome;
    if (outcome === 'reuse') await this.events.publishSecurity({ type: 'platform.refresh_token_reuse' });
    throw new UnauthorizedError('INVALID_REFRESH', 'Session expired, please sign in again');
  }

  async logout(raw: string | undefined): Promise<void> {
    const parsed = parseOpaqueToken(raw);
    if (!parsed) return;
    await this.db.platformTransaction(async (tx) => {
      const token = await tx.platformRefreshToken.findUnique({ where: { id: parsed.id } });
      if (!token || !safeEqualHex(token.tokenHash, sha256(parsed.secret))) return;
      await tx.platformRefreshToken.updateMany({ where: { familyId: token.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
  }

  private async issue(adminId: string, familyId: string, replaces?: string): Promise<PlatformSession> {
    const { secret, hash } = newOpaqueSecret();
    const refreshExpiresAt = new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    const created = await this.db.client.platformRefreshToken.create({
      data: { adminId, familyId, tokenHash: hash, expiresAt: refreshExpiresAt },
      select: { id: true },
    });
    if (replaces) {
      await this.db.client.platformRefreshToken.update({ where: { id: replaces }, data: { revokedAt: new Date(), replacedById: created.id } });
    }
    return {
      accessToken: await this.tokens.signPlatform({ sub: adminId }),
      expiresIn: this.tokens.accessTtlSeconds,
      refreshToken: `${created.id}.${secret}`,
      refreshExpiresAt,
    };
  }
}
