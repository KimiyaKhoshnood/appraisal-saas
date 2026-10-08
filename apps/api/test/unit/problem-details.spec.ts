import type { ArgumentsHost } from '@nestjs/common';
import { EventBus, NotFoundError, ProblemDetailsFilter, TooManyRequestsError } from '../../src/core';

function run(exception: unknown) {
  const headers: Record<string, string> = {};
  let status = 0;
  let body: Record<string, unknown> = {};
  const res = {
    headersSent: false,
    setHeader: (k: string, v: string) => (headers[k] = v),
    status(s: number) {
      status = s;
      return this;
    },
    type() {
      return this;
    },
    json(b: Record<string, unknown>) {
      body = b;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ method: 'GET', path: '/x' }) }) } as unknown as ArgumentsHost;
  return new ProblemDetailsFilter(new EventBus()).catch(exception, host).then(() => ({ status, body, headers }));
}

describe('problem details mapping', () => {
  it('sheds overload (statement timeout, pool exhausted) as 503 with Retry-After', async () => {
    for (const msg of ['canceling statement due to statement timeout', 'Transaction API error: Unable to start a transaction in the given time.']) {
      const r = await run(new Error(msg));
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('OVERLOADED');
      expect(r.headers['Retry-After']).toBe('1');
    }
  });

  it('maps rate limiting to 429 with the computed Retry-After', async () => {
    const r = await run(new TooManyRequestsError(7));
    expect(r.status).toBe(429);
    expect(r.headers['Retry-After']).toBe('7');
  });

  it('never leaks internals of unexpected errors', async () => {
    const r = await run(new Error('connection string postgres://secret@db'));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/secret/);
  });

  it('gives the uniform 404 for missing resources', async () => {
    const r = await run(new NotFoundError('evaluation', 'x'));
    expect(r.body).toMatchObject({ status: 404, code: 'NOT_FOUND', detail: 'The requested resource was not found' });
  });
});
