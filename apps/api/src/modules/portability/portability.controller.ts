import { createHash } from 'node:crypto';
import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { EventBus, RequirePermission, TenantContext, TenantExportRegistry } from '../../core';

@Controller()
export class PortabilityController {
  constructor(
    private readonly registry: TenantExportRegistry,
    private readonly events: EventBus,
  ) {}

  /**
   * Full export of the organisation (data portability). Tenant admins only; the export is a
   * security-relevant event and is audited with its row count and manifest digest, never content.
   */
  @Get('tenant/export')
  @RequirePermission('data:export')
  async export(@Res({ passthrough: true }) res: Response) {
    const result = await this.registry.exportCurrentTenant();
    const access = TenantContext.requireAccess();
    const manifestSha256 = createHash('sha256').update(JSON.stringify(result.manifest)).digest('hex');
    await this.events.publish({
      type: 'data.exported',
      category: 'SECURITY',
      entityType: 'tenant',
      entityId: result.tenantId,
      metadata: { sections: result.manifest.length, rows: result.manifest.reduce((n, m) => n + m.rows, 0), manifestSha256 },
    });
    const day = result.exportedAt.slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="${access.tenant.slug}-export-${day}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    return { ...result, tenant: { slug: access.tenant.slug, name: access.tenant.name, plan: access.tenant.plan } };
  }
}
