import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../configuration';
import { IamModule } from '../iam';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAuthController, PlatformController } from './platform.controller';
import { TenantDirectoryService } from './tenant-directory.service';
import { TenantsService } from './tenants.service';

/** platform: tenant lifecycle, onboarding, plans, platform admins. Depends on: iam, configuration, audit. */
@Module({
  imports: [IamModule, ConfigurationModule],
  controllers: [PlatformAuthController, PlatformController],
  providers: [TenantDirectoryService, TenantsService, PlatformAuthService, PlatformAuditService],
  exports: [TenantDirectoryService, PlatformAuthService, TenantsService],
})
export class PlatformModule {}

export { TenantDirectoryService } from './tenant-directory.service';
export { PlatformAuthService } from './platform-auth.service';
export { TenantsService, type ProvisionResult } from './tenants.service';
