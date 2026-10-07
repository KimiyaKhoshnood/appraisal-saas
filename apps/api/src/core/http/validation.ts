import { Body, Param, PipeTransform, Query } from '@nestjs/common';
import { z, type ZodType } from 'zod';
import { ValidationFailedError } from '../errors/app-errors';

export function zodIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((i) => ({
    path: i.path.map(String).join('.') || '(root)',
    message: i.code === 'unrecognized_keys' ? `Unknown field(s): ${i.keys.join(', ')}` : i.message,
  }));
}

export class ZodValidationPipe<T extends ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const parsed = this.schema.safeParse(value ?? {});
    if (!parsed.success) throw new ValidationFailedError(zodIssues(parsed.error));
    return parsed.data;
  }
}

/** Route schema metadata, read by the OpenAPI generator and the isolation-matrix test. */
export const SCHEMA_KEY = 'appraisal:schemas';
export interface RouteSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: string[];
}

function appendSchema(target: object, key: string | symbol | undefined, patch: RouteSchemas) {
  if (key === undefined) return;
  const handler = (target as Record<string | symbol, object>)[key]!;
  const current: RouteSchemas = Reflect.getMetadata(SCHEMA_KEY, handler) ?? {};
  const merged: RouteSchemas = {
    ...current,
    ...patch,
    params: [...(current.params ?? []), ...(patch.params ?? [])],
  };
  Reflect.defineMetadata(SCHEMA_KEY, merged, handler);
}

/**
 * Validated, strict body. Unknown keys (e.g. `tenantId`, `role`) are rejected with 400 rather
 * than silently stripped: mass assignment is an attack signal worth surfacing (T4, NF-05).
 */
export const ValidBody =
  (schema: ZodType): ParameterDecorator =>
  (target, key, index) => {
    Body(new ZodValidationPipe(schema))(target, key, index);
    appendSchema(target, key, { body: schema });
  };

export const ValidQuery =
  (schema: ZodType): ParameterDecorator =>
  (target, key, index) => {
    Query(new ZodValidationPipe(schema))(target, key, index);
    appendSchema(target, key, { query: schema });
  };

const uuidSchema = z.uuid();

/** A path id. Malformed → 400; well-formed but unknown or foreign → 404 from the service. */
export const IdParam =
  (name = 'id'): ParameterDecorator =>
  (target, key, index) => {
    Param(name, {
      transform(value: unknown) {
        const parsed = uuidSchema.safeParse(value);
        if (!parsed.success) throw new ValidationFailedError([{ path: name, message: 'Must be a UUID' }]);
        return parsed.data;
      },
    })(target, key, index);
    appendSchema(target, key, { params: [name] });
  };
