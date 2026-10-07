import { Module } from '@nestjs/common';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from './configuration.service';

/** configuration: typed settings, feature flags, branding, layered resolution. Depends on: audit. */
@Module({
  controllers: [ConfigurationController],
  providers: [ConfigurationService],
  exports: [ConfigurationService],
})
export class ConfigurationModule {}

export { ConfigurationService, type EffectiveConfig } from './configuration.service';
