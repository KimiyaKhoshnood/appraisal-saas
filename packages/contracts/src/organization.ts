import { z } from 'zod';
import { uuid } from './common.js';

export const createDepartmentSchema = z.object({ name: z.string().trim().min(2).max(120) }).strict();
export const updateDepartmentSchema = createDepartmentSchema;

export const updateEmployeeProfileSchema = z
  .object({
    departmentId: uuid.nullable().optional(),
    managerId: uuid.nullable().optional(),
    jobTitle: z.string().trim().max(120).nullable().optional(),
  })
  .strict();
export type UpdateEmployeeProfileInput = z.infer<typeof updateEmployeeProfileSchema>;

export interface DepartmentView {
  id: string;
  name: string;
  employeeCount: number;
}

export interface EmployeeView {
  userId: string;
  fullName: string;
  email: string;
  jobTitle: string | null;
  department: { id: string; name: string } | null;
  manager: { id: string; fullName: string } | null;
}
