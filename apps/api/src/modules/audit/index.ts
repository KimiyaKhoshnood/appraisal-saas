import { Module, type OnModuleInit } from '@nestjs/common';
import { TenantExportRegistry } from '../../core';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule implements OnModuleInit {
  constructor(private readonly exportRegistry: TenantExportRegistry) {}

  /** Tables this module owns, for the tenant data export. */
  onModuleInit(): void {
    const registry = this.exportRegistry;
    registry.register({ module: 'audit', table: 'audit_log' });
  }
}

export { sanitizeMetadata } from './audit.service';
