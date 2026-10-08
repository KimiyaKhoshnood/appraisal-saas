import { afterEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES, translate } from '../i18n/messages';
import { ApiClient, ApiError } from './api';
import { detectApp } from './host';
import { applyBranding } from './theme';

describe('host detection', () => {
  it.each([
    ['acme.localhost', { kind: 'tenant', slug: 'acme' }],
    ['admin.localhost', { kind: 'platform' }],
    ['localhost', { kind: 'landing' }],
    ['acme.appraisal.example', { kind: 'tenant', slug: 'acme' }],
    ['appraisal.example', { kind: 'landing' }],
    ['a.b.localhost', { kind: 'landing' }],
  ])('%s', (host, expected) => expect(detectApp(host)).toEqual(expected));
});

describe('i18n', () => {
  it('has a Persian string for every English key', () => {
    expect(Object.keys(MESSAGES.fa).sort()).toEqual(Object.keys(MESSAGES.en).sort());
  });
  it('interpolates variables', () => {
    expect(translate('en', 'dash.hello', { name: 'Ada' })).toBe('Hello, Ada');
    expect(translate('fa', 'dash.hello', { name: 'گیتا' })).toBe('سلام، گیتا');
  });
});

describe('theming', () => {
  it('sets brand variables, language and direction from the tenant branding', () => {
    applyBranding({ appName: 'Globex', primaryColor: '#b45309', secondaryColor: '#7c3aed', locale: 'fa' });
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--brand')).toBe('#b45309');
    expect(root.dir).toBe('rtl');
    expect(root.lang).toBe('fa');
    expect(document.title).toBe('Globex');
  });
});

describe('ApiClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refreshes once for concurrent 401s and retries with the new token', async () => {
    let refreshes = 0;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/refresh')) {
        refreshes++;
        return new Response(JSON.stringify({ accessToken: 'new', expiresIn: 900 }), { status: 200 });
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer new' ? new Response(JSON.stringify({ ok: true }), { status: 200 }) : new Response('{}', { status: 401 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const api = new ApiClient('/api/auth');
    const results = await Promise.all([api.get('/api/a'), api.get('/api/b'), api.get('/api/c')]);
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(refreshes).toBe(1);
  });

  it('turns problem+json into a typed ApiError with field errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ type: 'x', title: 'Bad Request', status: 400, code: 'VALIDATION_FAILED', errors: [{ path: 'email', message: 'Invalid' }] }), {
          status: 400,
        }),
      ),
    );
    const err = await new ApiClient('/api/auth').post('/api/users', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('VALIDATION_FAILED');
    expect((err as ApiError).fieldErrors).toEqual({ email: 'Invalid' });
  });
});
