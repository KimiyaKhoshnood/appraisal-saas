import { z } from 'zod';

export const uuid = z.uuid();
export const email = z.email().max(254).transform((v) => v.trim().toLowerCase());
export const password = z
  .string()
  .min(10, 'At least 10 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Must contain a letter')
  .regex(/\d/, 'Must contain a digit');
export const personName = z.string().trim().min(2).max(120);

export const MAX_PAGE_SIZE = 100;

export const pageQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
    cursor: z.uuid().optional(),
  })
  .strict();
export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** RFC 9457 problem details, the single error shape of the API. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: string;
  requestId?: string;
  errors?: { path: string; message: string }[];
}
