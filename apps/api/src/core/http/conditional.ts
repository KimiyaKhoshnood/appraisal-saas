import { CallHandler, ExecutionContext, Injectable, NestInterceptor, createParamDecorator } from '@nestjs/common';
import type { Request, Response } from 'express';
import { map, type Observable } from 'rxjs';
import { ValidationFailedError } from '../errors/app-errors';

/**
 * Conditional requests (RFC 9110 §13) over a resource's optimistic-concurrency `version`.
 *
 * Reads carry `ETag: "v<version>"`; writes may send it back in `If-Match`. If the resource changed
 * since the client read it, the write is refused with 412 instead of silently overwriting someone
 * else's work (the "lost update" over user think-time, which a version check inside one request
 * cannot see). `If-None-Match` on a read gets 304 for free from Express once the ETag is set.
 */
export const etagOf = (version: number) => `"v${version}"`;

const ENTITY_TAG = /^(?:W\/)?"v(\d{1,9})"$/;

/** Parses `If-Match`. Absent or `*` → undefined (no precondition); malformed → 400. */
export function parseIfMatch(header: string | undefined): number | undefined {
  if (header === undefined || header.trim() === '*') return undefined;
  const match = ENTITY_TAG.exec(header.trim());
  if (!match) throw new ValidationFailedError([{ path: 'If-Match', message: 'Expected an entity tag such as "v3"' }]);
  return Number(match[1]);
}

export const IfMatch = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  parseIfMatch(ctx.switchToHttp().getRequest<Request>().header('if-match')),
);

/** Sets the ETag of any response body that carries a numeric `version`. */
@Injectable()
export class VersionETagInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((body: unknown) => {
        const version = (body as { version?: unknown } | null)?.version;
        if (typeof version === 'number') ctx.switchToHttp().getResponse<Response>().setHeader('ETag', etagOf(version));
        return body;
      }),
    );
  }
}
