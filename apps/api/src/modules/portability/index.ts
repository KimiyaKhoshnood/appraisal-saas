import { Module } from '@nestjs/common';
import { PortabilityController } from './portability.controller';

/**
 * portability: the organisation's own data, downloadable by its administrator. Owns no table;
 * the tables come from every module's registration with core's TenantExportRegistry.
 * Depends on: nothing but tenancy-core.
 */
@Module({
  controllers: [PortabilityController],
})
export class PortabilityModule {}
