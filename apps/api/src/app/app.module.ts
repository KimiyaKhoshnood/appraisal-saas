import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import {
  ACCESS_CONTEXT_LOADER,
  AuthGuard,
  CoreModule,
  ENV,
  FeatureGuard,
  PLATFORM_ADMIN_LOOKUP,
  PermissionGuard,
  ProblemDetailsFilter,
  RateLimitGuard,
  TENANT_LOOKUP,
  TenantGuard,
  loggerConfig,
  type Env,
} from '../core';
import { AuditModule } from '../modules/audit';
import { ConfigurationModule } from '../modules/configuration';
import { EvaluationModule } from '../modules/evaluation';
import { IamModule } from '../modules/iam';
import { OrganizationModule } from '../modules/organization';
import { PlatformAuthService, PlatformModule, TenantDirectoryService } from '../modules/platform';
import { ReportingModule } from '../modules/reporting';
import { AccessContextLoaderImpl } from './access-context.loader';
import { MeController, SystemController } from './system.controller';

/**
 * Composition root: the only place allowed to import every module. It binds core ports to their
 * module implementations and fixes the order of the request gates.
 */
@Module({
  imports: [
    CoreModule,
    LoggerModule.forRootAsync({ inject: [ENV], useFactory: (env: Env) => loggerConfig(env) }),
    AuditModule,
    IamModule,
    ConfigurationModule,
    OrganizationModule,
    PlatformModule,
    EvaluationModule,
    ReportingModule,
  ],
  controllers: [SystemController, MeController],
  providers: [
    AccessContextLoaderImpl,
    { provide: ACCESS_CONTEXT_LOADER, useExisting: AccessContextLoaderImpl },
    { provide: TENANT_LOOKUP, useExisting: TenantDirectoryService },
    { provide: PLATFORM_ADMIN_LOOKUP, useExisting: PlatformAuthService },
    // Order matters: 401 → 403/404 (tenant) → 429 → 404 (feature) → 403 (permission).
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: FeatureGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}

