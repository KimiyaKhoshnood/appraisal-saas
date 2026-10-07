import { Writable } from 'node:stream';
import pino from 'pino';
import { TenantContext, loadEnv, loggerConfig } from '../../src/core';

/** NF-14 (JSON lines with tenantId and requestId) and NF-06/T10 (no secrets or scores in logs). */
describe('structured logging', () => {
  const env = loadEnv({ DATABASE_URL: 'postgres://x', TENANT_JWT_SECRET: 't'.repeat(32), PLATFORM_JWT_SECRET: 'p'.repeat(32), NODE_ENV: 'test' });
  const http = loggerConfig(env).pinoHttp as pino.LoggerOptions;

  function capture() {
    const lines: Record<string, unknown>[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(JSON.parse(chunk.toString()));
        cb();
      },
    });
    const logger = pino({ level: 'info', mixin: http.mixin, redact: http.redact }, stream);
    return { logger, lines };
  }

  it('adds requestId and tenantId from the request context to every line', () => {
    const { logger, lines } = capture();
    TenantContext.run(
      { requestId: 'req-1', ip: null, tenantId: 'tenant-1', actor: { type: 'USER', id: 'u', name: null }, access: null, tx: undefined },
      () => logger.info('hello'),
    );
    expect(lines[0]).toMatchObject({ msg: 'hello', requestId: 'req-1', tenantId: 'tenant-1' });
  });

  it('redacts credentials and evaluation content', () => {
    const { logger, lines } = capture();
    logger.info({ body: { password: 'hunter2', score: 5, comment: 'private', name: 'ok' } }, 'payload');
    expect(lines[0]!.body).toEqual({ password: '[redacted]', score: '[redacted]', comment: '[redacted]', name: 'ok' });
  });
});
