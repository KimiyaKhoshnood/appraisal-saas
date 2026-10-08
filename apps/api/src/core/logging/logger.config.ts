import { RequestMethod } from '@nestjs/common';
import type { Params } from 'nestjs-pino';
import type { IncomingMessage } from 'node:http';
import type { Env } from '../config/env';
import { TenantContext, type RequestStore } from '../context/request-context';

type Req = IncomingMessage & { store?: RequestStore };

/**
 * Structured JSON logs (NF-14): every line carries requestId and, once known, tenantId and
 * the actor. Credentials and evaluation content are redacted (NF-06, T10).
 */
export function loggerConfig(env: Env): Params {
  return {
    // Express 5 / path-to-regexp v8 wildcard syntax (the default '*' is legacy).
    forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
    pinoHttp: {
      level: env.LOG_LEVEL,
      genReqId: (req) => (req as Req).store?.requestId ?? 'unknown',
      customProps: (req) => {
        const store = (req as Req).store;
        return store ? { tenantId: store.tenantId, actorId: store.actor.id, actorType: store.actor.type } : {};
      },
      mixin() {
        const store = TenantContext.current();
        return store ? { requestId: store.requestId, tenantId: store.tenantId ?? undefined } : {};
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          '*.password',
          '*.passwordHash',
          '*.token',
          '*.accessToken',
          '*.score',
          '*.comment',
        ],
        censor: '[redacted]',
      },
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      // Human-readable only on an interactive dev terminal; containers and CI always get JSON lines.
      ...(env.NODE_ENV === 'development' && process.stdout.isTTY ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
    },
  };
}
