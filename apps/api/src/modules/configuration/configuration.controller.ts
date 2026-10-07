import { Controller, Get, Put, Req } from '@nestjs/common';
import { brandingSchema, evaluationPolicyOverrideSchema, type Branding, type EvaluationPolicyOverride } from '@appraisal/contracts';
import { z } from 'zod';
import { Public, RequirePermission, TenantContext, ValidBody, type AppRequest } from '../../core';
import { ConfigurationService } from './configuration.service';

const featureChangesSchema = z.record(z.string().max(40), z.boolean()).refine((v) => Object.keys(v).length > 0, {
  message: 'At least one feature',
});

@Controller()
export class ConfigurationController {
  constructor(private readonly config: ConfigurationService) {}

  /** Pre-login branding for the sub-domain's login page: name, logo and colours only. */
  @Get('public/branding')
  @Public({ tenant: 'host' })
  publicBranding(@Req() req: AppRequest) {
    return this.config.publicBranding(req.tenant!.name);
  }

  @Get('config/branding')
  @RequirePermission('config:read')
  async branding() {
    return (await this.config.effective(TenantContext.requireAccess().tenant.plan)).branding;
  }

  @Put('config/branding')
  @RequirePermission('config:write')
  updateBranding(@ValidBody(brandingSchema) body: Branding) {
    return this.config.updateBranding(body, TenantContext.requireAccess().tenant.plan);
  }

  @Get('config/features')
  @RequirePermission('config:read')
  features() {
    return this.config.features(TenantContext.requireAccess().tenant.plan);
  }

  @Put('config/features')
  @RequirePermission('config:write')
  setFeatures(@ValidBody(featureChangesSchema) body: Record<string, boolean>) {
    return this.config.setFeatures(body, TenantContext.requireAccess().tenant.plan);
  }

  @Get('config/evaluation-policy')
  @RequirePermission('config:read')
  policy() {
    return this.config.policy(TenantContext.requireAccess().tenant.plan);
  }

  @Put('config/evaluation-policy')
  @RequirePermission('config:write')
  updatePolicy(@ValidBody(evaluationPolicyOverrideSchema) body: EvaluationPolicyOverride) {
    return this.config.updatePolicy(body, TenantContext.requireAccess().tenant.plan);
  }
}
