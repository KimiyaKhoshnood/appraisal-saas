import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FeatureKey } from '@appraisal/contracts';
import type { Request } from 'express';
import { ENV, type Env } from '../config/env';
import { TenantContext, type RequestStore } from '../context/request-context';
import { ForbiddenError, NotFoundError, TooManyRequestsError, UnauthorizedError } from '../errors/app-errors';
import { EventBus } from '../events/event-bus';
import {
  ACCESS_CONTEXT_LOADER,
  PLATFORM_ADMIN_LOOKUP,
  TENANT_LOOKUP,
  type AccessContextLoader,
  type PlatformAdminLookup,
  type TenantLookup,
  type TenantRecord,
} from '../ports';
import { TokenBucketLimiter } from '../rate-limit/token-bucket';
import { classifyHost } from '../tenancy/host';
import { ACCESS_KEY, FEATURE_KEY, RATE_LIMIT_KEY, type AccessPolicy } from './access.decorators';
import { TokenService, type TenantClaims } from './token.service';

/*
 * The request pipeline of the architecture document, one class per gate, registered in this
 * order (SecurityModule):
 *
 *   AuthGuard → TenantGuard → RateLimitGuard → FeatureGuard → PermissionGuard → (pipes) → service
 *     401         403/404         429              404              403            400
 */

export interface AppRequest extends Request {
  store: RequestStore;
  tenantClaims?: TenantClaims;
  tenant?: TenantRecord;
}

function policyOf(reflector: Reflector, ctx: ExecutionContext): AccessPolicy {
  const policy = reflector.getAllAndOverride<AccessPolicy | undefined>(ACCESS_KEY, [ctx.getHandler(), ctx.getClass()]);
  // RouteRegistry refuses to boot without a policy; this is a second line of defence.
  if (!policy) throw new ForbiddenError('NO_ACCESS_POLICY', 'Route has no access policy');
  return policy;
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/** Gate 1: signature, expiry, issuer and audience of the access token. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const policy = policyOf(this.reflector, ctx);
    if (policy.kind === 'public') return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const token = bearer(req);
    if (!token) throw new UnauthorizedError();

    if (policy.kind === 'platform') {
      const claims = await this.tokens.verifyPlatform(token);
      req.store.actor = { type: 'PLATFORM_ADMIN', id: claims.sub, name: null };
    } else {
      req.tenantClaims = await this.tokens.verifyTenant(token);
    }
    return true;
  }
}

/**
 * Gate 2: which tenant. After login the tenant comes from the signed `tid` claim only; the
 * sub-domain must agree with it (T5) and the tenant must be ACTIVE (T8). This is the single
 * place where an authenticated request's tenant id enters the context.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly events: EventBus,
    @Inject(ENV) private readonly env: Env,
    @Inject(TENANT_LOOKUP) private readonly tenants: TenantLookup,
    @Inject(ACCESS_CONTEXT_LOADER) private readonly access: AccessContextLoader,
    @Inject(PLATFORM_ADMIN_LOOKUP) private readonly admins: PlatformAdminLookup,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const policy = policyOf(this.reflector, ctx);
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const host = classifyHost(req.hostname, this.env.BASE_DOMAIN);

    if (policy.kind === 'platform') {
      if (host.kind !== 'platform') throw new ForbiddenError('WRONG_HOST', 'Platform API is served on the admin host only');
      const admin = await this.admins.activeAdmin(req.store.actor.id!);
      if (!admin) throw new UnauthorizedError('ACCOUNT_DISABLED', 'Account disabled');
      req.store.actor = { type: 'PLATFORM_ADMIN', id: admin.id, name: admin.fullName };
      return true;
    }

    if (policy.kind === 'public') {
      if (policy.tenant === 'none') return true;
      // Pre-login: the sub-domain selects the tenant, for non-sensitive endpoints only.
      if (host.kind !== 'tenant') throw new NotFoundError('tenant');
      const tenant = await this.tenants.bySlug(host.slug);
      if (!tenant || tenant.status !== 'ACTIVE') throw new NotFoundError('tenant');
      req.tenant = tenant;
      req.store.tenantId = tenant.id;
      return true;
    }

    const claims = req.tenantClaims!;
    const tenant = await this.tenants.byId(claims.tid);
    if (!tenant) throw new UnauthorizedError('INVALID_TOKEN', 'Invalid access token');

    if (host.kind !== 'tenant' || host.slug !== tenant.slug) {
      await TenantContext.runAs(tenant.id, { type: 'USER', id: claims.sub, name: null }, () =>
        this.events.publishSecurity({
          type: 'security.tenant_host_mismatch',
          metadata: { host: req.hostname, tokenTenant: tenant.slug },
        }),
      );
      throw new ForbiddenError('TENANT_MISMATCH', 'The token does not belong to this organisation');
    }
    if (tenant.status !== 'ACTIVE') {
      throw new ForbiddenError('TENANT_SUSPENDED', 'This organisation is suspended');
    }

    req.tenant = tenant;
    req.store.tenantId = tenant.id;
    req.store.actor = { type: 'USER', id: claims.sub, name: null };

    const access = await this.access.load(tenant, claims.sub);
    if (!access) throw new UnauthorizedError('ACCOUNT_DISABLED', 'Account disabled or removed');
    req.store.access = access;
    req.store.actor = { type: 'USER', id: access.user.id, name: access.user.fullName };
    return true;
  }
}

/**
 * Gate 3: per-tenant token bucket (T9). One tenant exhausting its budget gets 429 while every
 * other tenant keeps its own budget. Pre-login routes are bucketed per tenant + IP.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly limiter: TokenBucketLimiter;

  constructor(
    private readonly reflector: Reflector,
    @Inject(ENV) env: Env,
  ) {
    const perMinute = env.RATE_LIMIT_PER_TENANT_PER_MINUTE;
    // Burst = ten seconds of budget, refilled evenly. A full minute of burst (the first version)
    // let a noisy tenant run unthrottled for a whole E4 scenario; see docs/experiments E4.
    this.limiter = new TokenBucketLimiter(perMinute > 0 ? Math.max(10, Math.ceil(perMinute / 6)) : 0, perMinute / 60);
  }

  canActivate(ctx: ExecutionContext): boolean {
    const enabled = this.reflector.getAllAndOverride<boolean | undefined>(RATE_LIMIT_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (enabled === false) return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const tenantId = req.store.tenantId;
    const key = tenantId
      ? req.store.access
        ? `t:${tenantId}`
        : `t:${tenantId}:ip:${req.store.ip}`
      : `ip:${req.store.ip}`;
    const wait = this.limiter.take(key);
    if (wait > 0) throw new TooManyRequestsError(wait);
    return true;
  }
}

/** Gate 4: a feature that is off does not exist for the tenant: 404, not 403. */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const feature = this.reflector.getAllAndOverride<FeatureKey | undefined>(FEATURE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!feature) return true;
    const access = ctx.switchToHttp().getRequest<AppRequest>().store.access;
    if (!access?.features.has(feature)) throw new NotFoundError('feature', feature);
    return true;
  }
}

/** Gate 5: RBAC. Denials are security events (T6). */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly events: EventBus,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const policy = policyOf(this.reflector, ctx);
    if (policy.kind !== 'tenant' || policy.permissions.length === 0) return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const access = req.store.access!;
    const missing = policy.permissions.filter((p) => !access.permissions.has(p));
    if (missing.length === 0) return true;
    await this.events.publishSecurity({
      type: 'security.permission_denied',
      metadata: { missing, method: req.method, route: req.route?.path ?? req.path },
    });
    throw new ForbiddenError('PERMISSION_DENIED', `Missing permission: ${missing.join(', ')}`);
  }
}
