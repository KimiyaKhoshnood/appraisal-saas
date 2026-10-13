import { z } from 'zod';
import { email, password, personName, uuid } from './common.js';
import type { Permission } from './permissions.js';
import type { FeatureKey } from './features.js';
import type { Branding } from './branding.js';
import type { EvaluationPolicy } from './policy.js';

export const loginSchema = z
  .object({
    email,
    password: z.string().min(1).max(128),
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;

export interface TokenResponse {
  accessToken: string;
  expiresIn: number;
}

export const createUserSchema = z
  .object({
    email,
    fullName: personName,
    password,
    roleIds: z.array(uuid).max(10).default([]),
  })
  .strict();
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    fullName: personName.optional(),
  })
  .strict();

export const setPasswordSchema = z.object({ password }).strict();
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

export const setUserRolesSchema = z.object({ roleIds: z.array(uuid).min(1).max(10) }).strict();

export const createRoleSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    permissions: z.array(z.string()).min(1).max(50),
  })
  .strict();
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export const updateRoleSchema = createRoleSchema.partial().strict();

export interface UserView {
  id: string;
  email: string;
  fullName: string;
  active: boolean;
  /** False for users restored from an archive until an administrator sets a password. */
  hasPassword: boolean;
  roles: { id: string; name: string }[];
  createdAt: string;
}

export interface RoleView {
  id: string;
  name: string;
  systemKey: string | null;
  permissions: Permission[];
  userCount: number;
}

/** GET /me/context: everything the UI needs to build itself. Never a security decision. */
export interface MeContext {
  user: { id: string; email: string; fullName: string };
  tenant: { id: string; name: string; slug: string; plan: string };
  branding: Branding;
  features: FeatureKey[];
  permissions: Permission[];
  policy: EvaluationPolicy;
  isManager: boolean;
}
