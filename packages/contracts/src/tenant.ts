import { z } from 'zod';
import { PLAN_CODES } from './features.js';
import { brandingSchema } from './branding.js';
import { evaluationPolicyOverrideSchema } from './policy.js';
import { email, password, personName } from './common.js';

export const TENANT_STATUSES = ['PROVISIONING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

/** Sub-domains that can never be a tenant: they are or may become platform hosts. */
export const RESERVED_SLUGS = [
  'www',
  'api',
  'admin',
  'app',
  'auth',
  'platform',
  'static',
  'assets',
  'mail',
  'status',
  'localhost',
] as const;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Lowercase letters, digits and inner hyphens only')
  .refine((s) => !s.includes('--'), 'Consecutive hyphens are not allowed')
  .refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), 'This name is reserved');

export const createTenantSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: slugSchema,
    plan: z.enum(PLAN_CODES as [string, ...string[]]),
    admin: z
      .object({
        email,
        fullName: personName,
        password,
      })
      .strict(),
    branding: brandingSchema.optional(),
    features: z.array(z.string()).optional(),
    evaluationPolicy: evaluationPolicyOverrideSchema.optional(),
  })
  .strict();
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

/**
 * Restore an organisation from its export into a new tenant (ADR-016). The archive is validated
 * structurally here and verified against its own manifest by the server.
 */
export const tenantArchiveSchema = z.looseObject({
  format: z.literal('appraisal-tenant-export'),
  version: z.literal(1),
  tenantId: z.uuid(),
  manifest: z
    .array(z.object({ section: z.string().max(80), rows: z.number().int().min(0), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict())
    .max(100),
  data: z.record(z.string().max(63), z.array(z.record(z.string(), z.unknown()))),
});

export const importTenantSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: slugSchema,
    /** Defaults to the plan recorded in the archive. */
    plan: z.enum(PLAN_CODES as [string, ...string[]]).optional(),
    /** An active Tenant admin of the archive; gets this password, everyone else none yet. */
    admin: z.object({ email, password }).strict(),
    archive: tenantArchiveSchema,
  })
  .strict();
export type ImportTenantInput = z.infer<typeof importTenantSchema>;

export const changePlanSchema = z
  .object({ plan: z.enum(PLAN_CODES as [string, ...string[]]) })
  .strict();

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: TenantStatus;
  createdAt: string;
}
