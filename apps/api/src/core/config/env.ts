import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3000),
    DATABASE_URL: z.string().min(1),
    BASE_DOMAIN: z.string().min(1).default('localhost'),
    COOKIE_SECURE: bool.default(true),
    TRUST_PROXY: bool.default(false),
    TENANT_JWT_SECRET: z.string().min(32),
    PLATFORM_JWT_SECRET: z.string().min(32),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    RATE_LIMIT_PER_TENANT_PER_MINUTE: z.coerce.number().int().min(0).default(1200),
    STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(5000),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
    TENANCY_APP_FILTER: z.enum(['on', 'off']).default('on'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.TENANT_JWT_SECRET === env.PLATFORM_JWT_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['PLATFORM_JWT_SECRET'], message: 'Must differ from TENANT_JWT_SECRET' });
    }
    if (env.NODE_ENV === 'production' && env.TENANCY_APP_FILTER === 'off') {
      ctx.addIssue({ code: 'custom', path: ['TENANCY_APP_FILTER'], message: 'Cannot be disabled in production' });
    }
    if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'Must be true in production' });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Validated once at boot: a misconfigured instance refuses to start instead of failing open. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}

export const ENV = Symbol('ENV');
