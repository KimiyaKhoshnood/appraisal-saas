import { Module } from '@nestjs/common';
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
export class OrganizationModule {}

export { OrgDirectory } from './org-directory';
