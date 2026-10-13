import type { NextFunction, Request, Response } from 'express';
import type { AppRequest } from '../security/guards';
import { TenantMetrics } from './tenant-metrics';

/**
 * Records every finished response, including those rejected by a guard (401/403/429), which an
 * interceptor would never see. The tenant is the one the TenantGuard resolved for this request.
 */
export function metricsMiddleware(metrics: TenantMetrics) {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const route = req.route ? `${req.baseUrl}${(req.route as { path: string }).path}` : 'unmatched';
      if (route.endsWith('/metrics')) return;
      metrics.observe({
        tenant: (req as AppRequest).tenant?.slug ?? null,
        method: req.method,
        route,
        status: res.statusCode,
        seconds: Number(process.hrtime.bigint() - start) / 1e9,
      });
    });
    next();
  };
}
