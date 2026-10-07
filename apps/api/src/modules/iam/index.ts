import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthzService } from './authz.service';
import { RolesService } from './roles.service';
import { IamProvisioning, UserDirectory } from './user-directory';
import { RolesController, UsersController } from './users.controller';
import { UsersService } from './users.service';

/** iam: authentication, users, roles, permissions, refresh tokens. Depends on: audit (events). */
@Module({
  controllers: [AuthController, UsersController, RolesController],
  providers: [AuthService, AuthzService, UsersService, RolesService, UserDirectory, IamProvisioning],
  exports: [AuthzService, UserDirectory, IamProvisioning],
})
export class IamModule {}

export { AuthzService, type UserAccess } from './authz.service';
export { UserDirectory, IamProvisioning, type DirectoryUser } from './user-directory';
