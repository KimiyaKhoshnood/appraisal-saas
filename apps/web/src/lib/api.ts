import type { ProblemDetails, TokenResponse } from '@appraisal/contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetails,
  ) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }

  get code(): string {
    return this.problem.code;
  }

  /** Field errors keyed by path, for forms. */
  get fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.problem.errors ?? []).map((e) => [e.path, e.message]));
  }
}

type Json = Record<string, unknown> | unknown[];

/**
 * Thin fetch client. The access token lives in memory only (never localStorage: XSS could read
 * it); the refresh token is an httpOnly cookie the browser sends to /api/auth only. On a 401 the
 * client refreshes once (single-flight across concurrent requests) and retries.
 */
export class ApiClient {
  private accessToken: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  onSessionLost: () => void = () => {};

  constructor(private readonly authBase: '/api/auth' | '/api/platform/auth') {}

  get isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  async login(email: string, password: string): Promise<void> {
    const res = await this.raw('POST', `${this.authBase}/login`, { email, password }, false);
    this.accessToken = (res as TokenResponse).accessToken;
  }

  async logout(): Promise<void> {
    try {
      await this.raw('POST', `${this.authBase}/logout`, undefined, false);
    } finally {
      this.accessToken = null;
    }
  }

  /** Restores a session from the refresh cookie (page reload). */
  refresh(): Promise<boolean> {
    this.refreshing ??= (async () => {
      try {
        const res = (await this.raw('POST', `${this.authBase}/refresh`, undefined, false)) as TokenResponse;
        this.accessToken = res.accessToken;
        return true;
      } catch {
        this.accessToken = null;
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: Json): Promise<T> {
    return this.request<T>('POST', path, body ?? {});
  }
  put<T>(path: string, body: Json): Promise<T> {
    return this.request<T>('PUT', path, body);
  }
  patch<T>(path: string, body: Json): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }
  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  async download(path: string): Promise<Blob> {
    const res = await this.fetchWithAuth('GET', path);
    if (!res.ok) throw await toError(res);
    return res.blob();
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchWithAuth(method, path, body);
    if (!res.ok) throw await toError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private async fetchWithAuth(method: string, path: string, body?: unknown): Promise<Response> {
    let res = await this.send(method, path, body, true);
    if (res.status === 401 && (await this.refresh())) res = await this.send(method, path, body, true);
    if (res.status === 401) this.onSessionLost();
    return res;
  }

  private async raw(method: string, path: string, body: unknown, auth: boolean): Promise<unknown> {
    const res = await this.send(method, path, body, auth);
    if (!res.ok) throw await toError(res);
    return res.status === 204 ? undefined : res.json();
  }

  private send(method: string, path: string, body: unknown, auth: boolean): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    return fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }
}

async function toError(res: Response): Promise<ApiError> {
  let problem: ProblemDetails;
  try {
    problem = (await res.json()) as ProblemDetails;
  } catch {
    problem = { type: 'about:blank', title: res.statusText || 'Error', status: res.status, code: 'HTTP_ERROR' };
  }
  return new ApiError(res.status, problem);
}

export const tenantApi = new ApiClient('/api/auth');
export const platformApi = new ApiClient('/api/platform/auth');
