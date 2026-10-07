import { Controller, Get } from '@nestjs/common';
import { auditQuerySchema, type AuditQuery } from '@appraisal/contracts';
import { RequirePermission, ValidQuery } from '../../core';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** TA-07: search the tenant's audit log (changes and security events). */
  @Get()
  @RequirePermission('audit:read')
  search(@ValidQuery(auditQuerySchema) query: AuditQuery) {
    return this.audit.search(query);
  }
}
