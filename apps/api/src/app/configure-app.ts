import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { API_PREFIX, ENV, TenantMetrics, isAllowedOrigin, metricsMiddleware, requestContextMiddleware, type Env } from '../core';

/** Shared by main.ts and the e2e tests so both run exactly the same HTTP pipeline. */
export function configureApp(app: INestApplication, options: { logger?: boolean } = {}): INestApplication {
  const env = app.get<Env>(ENV);
  const express = app as NestExpressApplication;

  express.set('trust proxy', env.TRUST_PROXY ? 1 : false);
  express.disable('x-powered-by');
  // First middleware: opens the per-request AsyncLocalStorage scope.
  app.use(requestContextMiddleware);
  app.use(metricsMiddleware(app.get(TenantMetrics)));
  app.use(helmet());
  app.use(cookieParser());
  express.useBodyParser('json', { limit: '100kb' });
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => cb(null, !origin || isAllowedOrigin(origin, env.BASE_DOMAIN)),
    credentials: true,
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
  });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  if (options.logger !== false) app.useLogger(app.get(Logger));
  return app;
}
