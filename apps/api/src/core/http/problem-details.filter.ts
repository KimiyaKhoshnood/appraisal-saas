import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ProblemDetails } from '@appraisal/contracts';
import type { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client';
import { MissingTenantContextError, TenantContext } from '../context/request-context';
import { CrossTenantWriteError } from '../database/tenant-scope';
import { AppError, NotFoundError, TooManyRequestsError } from '../errors/app-errors';
import { EventBus } from '../events/event-bus';

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  412: 'Precondition Failed',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

function problem(status: number, code: string, detail?: string, errors?: ProblemDetails['errors']): ProblemDetails {
  return {
    type: `https://appraisal.example/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title: TITLES[status] ?? 'Error',
    status,
    code,
    ...(detail ? { detail } : {}),
    ...(errors?.length ? { errors } : {}),
  };
}

const NOT_FOUND = () => problem(404, 'NOT_FOUND', 'The requested resource was not found');

/** Every error leaves the API as application/problem+json (RFC 9457) with the request id. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  constructor(private readonly events: EventBus) {}

  async catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const body = await this.toProblem(exception, req);

    if (exception instanceof TooManyRequestsError) {
      res.setHeader('Retry-After', String(exception.retryAfterSeconds));
    } else if (body.status === 503) {
      res.setHeader('Retry-After', '1');
    }
    if (res.headersSent) return;
    res
      .status(body.status)
      .type('application/problem+json')
      .json({ ...body, requestId: TenantContext.current()?.requestId });
  }

  private async toProblem(exception: unknown, req: Request): Promise<ProblemDetails> {
    if (exception instanceof NotFoundError) {
      // Hidden features and unknown hosts are not probes for someone else's data.
      if (exception.entityType !== 'feature' && exception.entityType !== 'tenant') {
        await this.recordNotFound(exception.entityType, exception.entityId, req);
      }
      return NOT_FOUND();
    }
    if (exception instanceof AppError) {
      return problem(exception.status, exception.code, exception.message, exception.errors);
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === HttpStatus.NOT_FOUND) return NOT_FOUND();
      const message = exception.message;
      return problem(status, status >= 500 ? 'INTERNAL' : 'HTTP_ERROR', status >= 500 ? undefined : message);
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return problem(409, 'ALREADY_EXISTS', 'A resource with the same unique values already exists');
        case 'P2003':
        case 'P2025':
          // A composite FK pointing at another tenant's row fails exactly like a missing row.
          await this.recordNotFound('reference', undefined, req);
          return NOT_FOUND();
      }
    }
    if (this.isOverload(exception)) {
      // statement_timeout or no pooled connection in time: the request was shed to protect other
      // tenants (T9). Temporary by nature, so 503 + Retry-After rather than a 500.
      this.logger.warn({ err: exception }, 'request shed: statement timeout or pool exhausted');
      return problem(503, 'OVERLOADED', 'The service is busy, please retry shortly');
    }
    if (this.isRlsViolation(exception)) {
      this.logger.warn({ err: exception }, 'row-level security rejected a write');
      await this.recordNotFound('rls-write', undefined, req);
      return NOT_FOUND();
    }
    if (exception instanceof MissingTenantContextError || exception instanceof CrossTenantWriteError) {
      // A programming error that the isolation layers caught: loud in logs, generic to the client.
      this.logger.error({ err: exception }, 'tenant isolation guard tripped');
      return problem(500, 'INTERNAL', 'Unexpected error');
    }
    this.logger.error({ err: exception }, 'unhandled error');
    return problem(500, 'INTERNAL', 'Unexpected error');
  }

  private isOverload(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : '';
    return /canceling statement due to statement timeout|Unable to start a transaction in the given time|Timed out fetching a new connection/i.test(msg);
  }

  private isRlsViolation(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : '';
    return msg.includes('row-level security policy');
  }

  private async recordNotFound(entityType: string, entityId: string | undefined, req: Request) {
    if (!TenantContext.tenantId()) return;
    await this.events.publishSecurity({
      type: 'security.resource_not_found',
      entityType,
      ...(entityId ? { entityId } : {}),
      metadata: { method: req.method, route: req.route?.path ?? req.path },
    });
  }
}
