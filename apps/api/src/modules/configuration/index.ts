import { Module, type OnModuleInit } from '@nestjs/common';
import { TenantExportRegistry } from '../../core';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from './configuration.service';

/** configuration: typed settings, feature flags, branding, layered resolution. Depends on: audit. */
@Module({
  controllers: [ConfigurationController],
  providers: [ConfigurationService],
  exports: [ConfigurationService],
})
export class ConfigurationModule implements OnModuleInit {
  constructor(private readonly exportRegistry: TenantExportRegistry) {}

  /** Tables this module owns, for the tenant data export. */
  onModuleInit(): void {
    const registry = this.exportRegistry;
    registry.register({ module: 'configuration', table: 'tenant_settings' });
    registry.register({ module: 'configuration', table: 'tenant_feature' });
    registry.register({ module: 'configuration', table: 'tenant_branding' });
  }
}

export { ConfigurationService, type EffectiveConfig } from './configuration.service';
