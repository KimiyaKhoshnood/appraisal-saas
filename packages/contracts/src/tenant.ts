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
