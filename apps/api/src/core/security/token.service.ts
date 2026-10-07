import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ENV, type Env } from '../config/env';
import { UnauthorizedError } from '../errors/app-errors';

export const ISSUER = 'appraisal-saas';
export const TENANT_AUDIENCE = 'tenant-api';
export const PLATFORM_AUDIENCE = 'platform-api';

export interface TenantClaims {
  sub: string;
  /** Tenant id: the only source of the tenant after login (ADR-003). */
  tid: string;
}

export interface PlatformClaims {
  sub: string;
}

/**
 * Two identities, two keys, two audiences (ADR-005). A tenant token fails signature *and*
 * audience checks on platform routes, and vice versa (T5, T7). Roles are deliberately not in
 * the token: they are read server-side so a change applies on the next request (ADR-007).
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get accessTtlSeconds(): number {
    return this.env.ACCESS_TOKEN_TTL_SECONDS;
  }

  signTenant(claims: TenantClaims): Promise<string> {
    return this.jwt.signAsync(
      { tid: claims.tid },
      {
        secret: this.env.TENANT_JWT_SECRET,
        algorithm: 'HS256',
        audience: TENANT_AUDIENCE,
        issuer: ISSUER,
        subject: claims.sub,
        expiresIn: this.env.ACCESS_TOKEN_TTL_SECONDS,
      },
    );
  }

  signPlatform(claims: PlatformClaims): Promise<string> {
    return this.jwt.signAsync(
      {},
      {
        secret: this.env.PLATFORM_JWT_SECRET,
        algorithm: 'HS256',
        audience: PLATFORM_AUDIENCE,
        issuer: ISSUER,
        subject: claims.sub,
        expiresIn: this.env.ACCESS_TOKEN_TTL_SECONDS,
      },
    );
  }

  async verifyTenant(token: string): Promise<TenantClaims> {
    const payload = await this.verify(token, this.env.TENANT_JWT_SECRET, TENANT_AUDIENCE);
    if (typeof payload.tid !== 'string' || typeof payload.sub !== 'string') {
      throw new UnauthorizedError('INVALID_TOKEN', 'Invalid access token');
    }
    return { sub: payload.sub, tid: payload.tid };
  }

  async verifyPlatform(token: string): Promise<PlatformClaims> {
    const payload = await this.verify(token, this.env.PLATFORM_JWT_SECRET, PLATFORM_AUDIENCE);
    if (typeof payload.sub !== 'string') throw new UnauthorizedError('INVALID_TOKEN', 'Invalid access token');
    return { sub: payload.sub };
  }

  private async verify(token: string, secret: string, audience: string): Promise<Record<string, unknown>> {
    try {
      return await this.jwt.verifyAsync(token, { secret, audience, issuer: ISSUER, algorithms: ['HS256'] });
    } catch (err) {
      const expired = err instanceof Error && err.name === 'TokenExpiredError';
      throw new UnauthorizedError(
        expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
        expired ? 'Access token expired' : 'Invalid access token',
      );
    }
  }
}
