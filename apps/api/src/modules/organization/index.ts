import { Module, type OnModuleInit } from '@nestjs/common';
import { TenantExportRegistry } from '../../core';
import { IamModule } from '../iam';
import { OrgDirectory } from './org-directory';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';

/**
 * organization: departments and reporting lines. Depends on: iam (read-only UserDirectory for
 * names, a documented deviation from the phase-1 table, see ADR-001), audit (events).
 */
@Module({
  imports: [IamModule],
  controllers: [OrganizationController],
  providers: [OrganizationService, OrgDirectory],
  exports: [OrgDirectory],
})
export class OrganizationModule implements OnModuleInit {
  constructor(private readonly exportRegistry: TenantExportRegistry) {}

  /** Tables this module owns, for the tenant data export. */
  onModuleInit(): void {
    const registry = this.exportRegistry;
    registry.register({ module: 'organization', table: 'department' });
    registry.register({ module: 'organization', table: 'employee_profile' });
  }
}

export { OrgDirectory } from './org-directory';
