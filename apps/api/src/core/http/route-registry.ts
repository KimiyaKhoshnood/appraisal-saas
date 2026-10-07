import { Injectable, OnApplicationBootstrap, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { FeatureKey } from '@appraisal/contracts';
import { ACCESS_KEY, FEATURE_KEY, type AccessPolicy } from '../security/access.decorators';
import { SCHEMA_KEY, type RouteSchemas } from './validation';

export const API_PREFIX = 'api';

export interface RouteInfo {
  method: string;
  /** Express-style path including the global prefix, e.g. /api/users/:id */
  path: string;
  controller: string;
  handler: string;
  access: AccessPolicy | undefined;
  feature: FeatureKey | undefined;
  schemas: RouteSchemas;
}

function join(...parts: (string | undefined)[]): string {
  const p = parts
    .flatMap((s) => (s ?? '').split('/'))
    .filter(Boolean)
    .join('/');
  return `/${p}`;
}

/**
 * Introspects every route at boot. Two consumers:
 *  - `verify()` refuses to start the application if any route lacks an access policy;
 *  - the OpenAPI generator and the E1 isolation-matrix test enumerate routes from here, so a new
 *    endpoint is covered by the matrix automatically, without anyone remembering to add it.
 */
@Injectable()
export class RouteRegistry implements OnApplicationBootstrap {
  private cached: RouteInfo[] | null = null;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    this.verify();
  }

  routes(): RouteInfo[] {
    if (this.cached) return this.cached;
    const routes: RouteInfo[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      const base = Reflect.getMetadata(PATH_METADATA, metatype) as string | undefined;
      const proto = Object.getPrototypeOf(instance) as object;
      for (const name of this.scanner.getAllMethodNames(proto)) {
        const handler = (proto as Record<string, object>)[name]!;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (path === undefined || method === undefined) continue;
        routes.push({
          method: RequestMethod[method],
          path: join(API_PREFIX, base, path),
          controller: metatype.name,
          handler: name,
          access: this.reflector.getAllAndOverride<AccessPolicy>(ACCESS_KEY, [handler as never, metatype]),
          feature: this.reflector.getAllAndOverride<FeatureKey>(FEATURE_KEY, [handler as never, metatype]),
          schemas: (Reflect.getMetadata(SCHEMA_KEY, handler) as RouteSchemas | undefined) ?? {},
        });
      }
    }
    this.cached = routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
    return this.cached;
  }

  verify(): void {
    const missing = this.routes().filter((r) => !r.access);
    if (missing.length) {
      const list = missing.map((r) => `  ${r.method} ${r.path} (${r.controller}.${r.handler})`).join('\n');
      throw new Error(`Routes without an access policy (@Public/@PlatformRoute/@RequirePermission/@Authenticated):\n${list}`);
    }
  }
}
