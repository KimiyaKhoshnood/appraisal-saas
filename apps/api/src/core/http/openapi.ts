import { z } from 'zod';
import type { RouteInfo } from './route-registry';

/**
 * OpenAPI 3.1 generated from the same Zod schemas that validate requests: the documentation
 * cannot drift from the behaviour because there is only one definition.
 */
export function buildOpenApi(routes: RouteInfo[], version: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const r of routes) {
    const oasPath = r.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const op: Record<string, unknown> = {
      operationId: `${r.controller.replace(/Controller$/, '')}_${r.handler}`,
      tags: [r.path.split('/')[2] ?? 'root'],
      responses: {
        '2XX': { description: 'Success' },
        default: {
          description: 'Problem details (RFC 9457)',
          content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
        },
      },
    };

    const access = r.access;
    if (access?.kind === 'platform') op.security = [{ platformBearer: [] }];
    else if (access?.kind === 'tenant') op.security = [{ tenantBearer: [] }];
    else op.security = [];

    const notes: string[] = [];
    if (access?.kind === 'tenant' && access.permissions.length) notes.push(`Requires: ${access.permissions.join(', ')}`);
    if (access?.kind === 'public' && access.tenant === 'host') notes.push('Tenant resolved from the sub-domain');
    if (r.feature) notes.push(`Feature-gated: ${r.feature} (404 when off)`);
    if (notes.length) op.description = notes.join('. ');

    const parameters: Record<string, unknown>[] = (r.schemas.params ?? []).map((name) => ({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    }));
    if (r.schemas.query) {
      const json = z.toJSONSchema(r.schemas.query, { io: 'input', unrepresentable: 'any' }) as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      for (const [name, schema] of Object.entries(json.properties ?? {})) {
        parameters.push({ name, in: 'query', required: json.required?.includes(name) ?? false, schema });
      }
    }
    if (parameters.length) op.parameters = parameters;

    if (r.schemas.body) {
      op.requestBody = {
        required: true,
        content: {
          'application/json': { schema: z.toJSONSchema(r.schemas.body, { io: 'input', unrepresentable: 'any' }) },
        },
      };
    }

    paths[oasPath] ??= {};
    paths[oasPath][r.method.toLowerCase()] = op;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Appraisal SaaS API',
      version,
      description:
        'Multi-tenant performance appraisal. Tenant routes must be called on <slug>.BASE_DOMAIN with a tenant token; platform routes on admin.BASE_DOMAIN with a platform token.',
    },
    servers: [{ url: '/' }],
    paths,
    components: {
      securitySchemes: {
        tenantBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT (aud=tenant-api)' },
        platformBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT (aud=platform-api)' },
      },
      schemas: {
        Problem: {
          type: 'object',
          required: ['type', 'title', 'status', 'code'],
          properties: {
            type: { type: 'string' },
            title: { type: 'string' },
            status: { type: 'integer' },
            code: { type: 'string' },
            detail: { type: 'string' },
            requestId: { type: 'string' },
            errors: {
              type: 'array',
              items: { type: 'object', properties: { path: { type: 'string' }, message: { type: 'string' } } },
            },
          },
        },
      },
    },
  };
}
