import { Controller, Delete, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import {
  createDepartmentSchema,
  updateDepartmentSchema,
  updateEmployeeProfileSchema,
  type UpdateEmployeeProfileInput,
} from '@appraisal/contracts';
import { IdParam, RequirePermission, ValidBody } from '../../core';
import { OrganizationService } from './organization.service';

@Controller('org')
export class OrganizationController {
  constructor(private readonly org: OrganizationService) {}

  @Get('departments')
  @RequirePermission('org:read')
  departments() {
    return this.org.departments();
  }

  @Post('departments')
  @RequirePermission('org:write')
  createDepartment(@ValidBody(createDepartmentSchema) body: { name: string }) {
    return this.org.createDepartment(body.name);
  }

  @Patch('departments/:id')
  @RequirePermission('org:write')
  renameDepartment(@IdParam() id: string, @ValidBody(updateDepartmentSchema) body: { name: string }) {
    return this.org.renameDepartment(id, body.name);
  }

  @Delete('departments/:id')
  @HttpCode(204)
  @RequirePermission('org:write')
  deleteDepartment(@IdParam() id: string) {
    return this.org.deleteDepartment(id);
  }

  @Get('employees')
  @RequirePermission('org:read')
  employees() {
    return this.org.employees();
  }

  @Put('employees/:userId')
  @RequirePermission('org:write')
  updateProfile(@IdParam('userId') userId: string, @ValidBody(updateEmployeeProfileSchema) body: UpdateEmployeeProfileInput) {
    return this.org.updateProfile(userId, body);
  }
}
