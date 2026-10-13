import { Controller, Delete, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import {
  createRoleSchema,
  createUserSchema,
  pageQuerySchema,
  setPasswordSchema,
  setUserRolesSchema,
  updateRoleSchema,
  updateUserSchema,
  type CreateRoleInput,
  type CreateUserInput,
} from '@appraisal/contracts';
import { z } from 'zod';
import { IdParam, RequireFeature, RequirePermission, ValidBody, ValidQuery } from '../../core';
import { RolesService } from './roles.service';
import { UsersService } from './users.service';

const listUsersQuery = pageQuerySchema.extend({ search: z.string().trim().max(100).optional() });

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('user:read')
  list(@ValidQuery(listUsersQuery) q: z.infer<typeof listUsersQuery>) {
    return this.users.list(q);
  }

  @Get(':id')
  @RequirePermission('user:read')
  get(@IdParam() id: string) {
    return this.users.get(id);
  }

  @Post()
  @RequirePermission('user:write')
  create(@ValidBody(createUserSchema) body: CreateUserInput) {
    return this.users.create(body);
  }

  @Patch(':id')
  @RequirePermission('user:write')
  update(@IdParam() id: string, @ValidBody(updateUserSchema) body: z.infer<typeof updateUserSchema>) {
    return this.users.update(id, body);
  }

  @Post(':id/password')
  @HttpCode(200)
  @RequirePermission('user:write')
  setPassword(@IdParam() id: string, @ValidBody(setPasswordSchema) body: { password: string }) {
    return this.users.setPassword(id, body.password);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermission('user:write')
  deactivate(@IdParam() id: string) {
    return this.users.setActive(id, false);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermission('user:write')
  activate(@IdParam() id: string) {
    return this.users.setActive(id, true);
  }

  @Put(':id/roles')
  @RequirePermission('role:write')
  setRoles(@IdParam() id: string, @ValidBody(setUserRolesSchema) body: z.infer<typeof setUserRolesSchema>) {
    return this.users.setRoles(id, body.roleIds);
  }
}

@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermission('role:read')
  catalog() {
    return this.roles.catalog();
  }

  @Get('roles')
  @RequirePermission('role:read')
  list() {
    return this.roles.list();
  }

  @Post('roles')
  @RequirePermission('role:write')
  @RequireFeature('customRoles')
  create(@ValidBody(createRoleSchema) body: CreateRoleInput) {
    return this.roles.create(body);
  }

  @Patch('roles/:id')
  @RequirePermission('role:write')
  @RequireFeature('customRoles')
  update(@IdParam() id: string, @ValidBody(updateRoleSchema) body: Partial<CreateRoleInput>) {
    return this.roles.update(id, body);
  }

  @Delete('roles/:id')
  @HttpCode(204)
  @RequirePermission('role:write')
  @RequireFeature('customRoles')
  remove(@IdParam() id: string) {
    return this.roles.remove(id);
  }
}

