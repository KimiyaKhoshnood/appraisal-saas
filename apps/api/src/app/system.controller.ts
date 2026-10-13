import { Controller, Get, Header, Inject, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import type { MeContext } from '@appraisal/contracts';
import type { Request, Response } from 'express';
import {
  Authenticated,
  Database,
  ENV,
  NotFoundError,
  Public,
  RouteRegistry,
  SkipRateLimit,
  TenantContext,
  TenantMetrics,
  buildOpenApi,
  safeEqualHex,
  sha256,
  type Env,
} from '../core';
import { ConfigurationService } from '../modules/configuration';
import { OrgDirectory } from '../modules/organization';

@Controller()
export class SystemController {
  constructor(
    private readonly db: Database,
    private readonly routes: RouteRegistry,
    private readonly metrics: TenantMetrics,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Prometheus scrape endpoint. Tenant names are business data, so it needs its own bearer token
   * (compared in constant time); without METRICS_TOKEN configured it does not exist.
   */
  @Get('metrics')
  @Public()
  @SkipRateLimit()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  scrape(@Req() req: Request) {
    const expected = this.env.METRICS_TOKEN;
    const given = /^Bearer (.+)$/.exec(req.header('authorization') ?? '')?.[1];
    if (!expected || !given || !safeEqualHex(sha256(given), sha256(expected))) throw new NotFoundError('metrics');
    return this.metrics.exposition();
  }

  /** Liveness + database reachability (no tenant data). */
  @Get('health')
  @Public()
  @SkipRateLimit()
  async health() {
    try {
      await this.db.base.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('database unreachable');
    }
  }

  @Get('openapi.json')
  @Public()
  openapi() {
    return buildOpenApi(this.routes.routes(), process.env.npm_package_version ?? '0.1.0');
  }

  @Get('docs')
  @Public()
  @Header('Content-Type', 'text/html; charset=utf-8')
  docs(@Res({ passthrough: true }) res: Response) {
    // Swagger UI from a pinned CDN build; CSP is relaxed for this page only.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; img-src 'self' data:",
    );
    return `<!doctype html><html><head><meta charset="utf-8"><title>Appraisal API</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"></head>
<body><div id="ui"></div><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#ui' });</script></body></html>`;
  }
}

@Controller('me')
export class MeController {
  constructor(
    private readonly config: ConfigurationService,
    private readonly org: OrgDirectory,
  ) {}

  /**
   * FE-01/FE-02: branding, features, permissions and policy in one call. The UI builds its theme
   * and navigation from this; the server still re-checks every action.
   */
  @Get('context')
  @Authenticated()
  async context(): Promise<MeContext> {
    const access = TenantContext.requireAccess();
    const [config, isManager] = await Promise.all([this.config.effective(access.tenant.plan), this.org.hasReports(access.user.id)]);
    return {
      user: access.user,
      tenant: access.tenant,
      branding: config.branding,
      features: [...access.features],
      permissions: [...access.permissions],
      policy: access.policy,
      isManager,
    };
  }
}
