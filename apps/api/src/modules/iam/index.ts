import { Module, type OnModuleInit } from '@nestjs/common';
import { TenantExportRegistry } from '../../core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthzService } from './authz.service';
import { GrantPolicy } from './grant-policy';
import { RolesService } from './roles.service';
import { IamProvisioning, UserDirectory } from './user-directory';
import { RolesController, UsersController } from './users.controller';
import { UsersService } from './users.service';

/** iam: authentication, users, roles, permissions, refresh tokens. Depends on: audit (events). */
@Module({
  controllers: [AuthController, UsersController, RolesController],
  providers: [AuthService, AuthzService, GrantPolicy, UsersService, RolesService, UserDirectory, IamProvisioning],
  exports: [AuthzService, UserDirectory, IamProvisioning],
})
export class IamModule implements OnModuleInit {
  constructor(private readonly exportRegistry: TenantExportRegistry) {}

  /** Tables this module owns, for the tenant data export. */
  onModuleInit(): void {
    const registry = this.exportRegistry;
    // refresh_token is not exported: session secrets are not the organisation's data.
    registry.register({ module: 'iam', table: 'app_user', omit: ['password_hash'] });
    registry.register({ module: 'iam', table: 'role' });
    registry.register({ module: 'iam', table: 'role_permission' });
    registry.register({ module: 'iam', table: 'user_role' });
  }
}

export { AuthzService, type UserAccess } from './authz.service';
export { UserDirectory, IamProvisioning, type DirectoryUser } from './user-directory';
