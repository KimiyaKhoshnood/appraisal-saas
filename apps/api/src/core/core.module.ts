import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ENV, loadEnv } from './config/env';
import { Database } from './database/database.service';
import { EventBus } from './events/event-bus';
import { RouteRegistry } from './http/route-registry';
import { TenantMetrics } from './observability/tenant-metrics';
import { TenantExportRegistry } from './portability/tenant-export';
import { TokenService } from './security/token.service';

/** tenancy-core: shared kernel. Owns no tables and imports no domain module. */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    Database,
    EventBus,
    JwtService,
    TokenService,
    RouteRegistry,
    TenantExportRegistry,
    TenantMetrics,
  ],
  exports: [ENV, Database, EventBus, TokenService, RouteRegistry, TenantExportRegistry, TenantMetrics],
})
export class CoreModule {}
