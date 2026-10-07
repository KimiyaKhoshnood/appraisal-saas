import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { TenantContext, type RequestStore } from './request-context';

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Opens the AsyncLocalStorage scope for the whole request. Registered with `app.use` so it runs
 * before Nest's own pipeline; guards later fill in tenant and actor.
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const requestId = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  const store: RequestStore = {
    requestId,
    ip: req.ip ?? null,
    tenantId: null,
    actor: { type: 'ANONYMOUS', id: null, name: null },
    access: null,
    tx: undefined,
  };
  (req as Request & { store: RequestStore }).store = store;
  res.setHeader('X-Request-Id', requestId);
  TenantContext.run(store, () => next());
}
