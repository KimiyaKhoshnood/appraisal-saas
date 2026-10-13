import { Controller, Get, HttpCode, Inject, Post, Put, Req, Res } from '@nestjs/common';
import {
  changePlanSchema,
  createTenantSchema,
  importTenantSchema,
  loginSchema,
  pageQuerySchema,
  type CreateTenantInput,
  type ImportTenantInput,
  type LoginInput,
  type PageQuery,
  type PlanCode,
  type TokenResponse,
} from '@appraisal/contracts';
import type { Request, Response } from 'express';
import { ENV, IdParam, NotFoundError, PlatformRoute, Public, TenantMetrics, ValidBody, ValidQuery, classifyHost, type Env } from '../../core';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformAuthService, type PlatformSession } from './platform-auth.service';
import { TenantsService } from './tenants.service';

export const PLATFORM_REFRESH_COOKIE = 'prt';
const COOKIE_PATH = '/api/platform/auth';

@Controller('platform/auth')
export class PlatformAuthController {
  constructor(
    private readonly auth: PlatformAuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Public()
  async login(@Req() req: Request, @ValidBody(loginSchema) body: LoginInput, @Res({ passthrough: true }) res: Response) {
    this.requirePlatformHost(req);
    return this.respond(await this.auth.login(body), res);
  }

  @Post('refresh')
  @HttpCode(200)
  @Public()
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.requirePlatformHost(req);
    try {
      return this.respond(await this.auth.refresh(req.cookies?.[PLATFORM_REFRESH_COOKIE]), res);
    } catch (err) {
      res.clearCookie(PLATFORM_REFRESH_COOKIE, { path: COOKIE_PATH });
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(204)
  @Public()
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.requirePlatformHost(req);
    await this.auth.logout(req.cookies?.[PLATFORM_REFRESH_COOKIE]);
    res.clearCookie(PLATFORM_REFRESH_COOKIE, { path: COOKIE_PATH });
  }

  /** The platform login does not exist on tenant hosts. */
  private requirePlatformHost(req: Request) {
    if (classifyHost(req.hostname, this.env.BASE_DOMAIN).kind !== 'platform') throw new NotFoundError('route');
  }

  private respond(session: PlatformSession, res: Response): TokenResponse {
    res.cookie(PLATFORM_REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'strict',
      path: COOKIE_PATH,
      expires: session.refreshExpiresAt,
    });
    res.setHeader('Cache-Control', 'no-store');
    return { accessToken: session.accessToken, expiresIn: session.expiresIn };
  }
}

@Controller('platform')
export class PlatformController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly audit: PlatformAuditService,
    private readonly metrics: TenantMetrics,
  ) {}

  /**
   * Operator view of every tenant's traffic over the last minutes (this instance): requests,
   * 5xx rate, throttled requests, p50/p95 latency. Counts only, never tenant content.
   */
  @Get('tenant-health')
  @PlatformRoute()
  tenantHealth() {
    return { windowMinutes: 5, generatedAt: new Date().toISOString(), tenants: this.metrics.health() };
  }

  @Get('tenants')
  @PlatformRoute()
  list() {
    return this.tenants.list();
  }

  @Post('tenants')
  @PlatformRoute()
  create(@ValidBody(createTenantSchema) body: CreateTenantInput) {
    return this.tenants.create(body);
  }

  /** Restore an export into a new tenant. Larger body limit for this route only (configure-app). */
  @Post('tenants/import')
  @PlatformRoute()
  restore(@ValidBody(importTenantSchema) body: ImportTenantInput) {
    return this.tenants.restore(body);
  }

  @Get('tenants/:id')
  @PlatformRoute()
  get(@IdParam() id: string) {
    return this.tenants.get(id);
  }

  @Post('tenants/:id/suspend')
  @HttpCode(200)
  @PlatformRoute()
  suspend(@IdParam() id: string) {
    return this.tenants.setStatus(id, 'SUSPENDED');
  }

  @Post('tenants/:id/activate')
  @HttpCode(200)
  @PlatformRoute()
  activate(@IdParam() id: string) {
    return this.tenants.setStatus(id, 'ACTIVE');
  }

  @Put('tenants/:id/plan')
  @PlatformRoute()
  changePlan(@IdParam() id: string, @ValidBody(changePlanSchema) body: { plan: string }) {
    return this.tenants.changePlan(id, body.plan as PlanCode);
  }

  @Get('plans')
  @PlatformRoute()
  plans() {
    return this.tenants.plans();
  }

  @Get('audit')
  @PlatformRoute()
  auditLog(@ValidQuery(pageQuerySchema) q: PageQuery) {
    return this.audit.list(q.limit, q.cursor);
  }
}
