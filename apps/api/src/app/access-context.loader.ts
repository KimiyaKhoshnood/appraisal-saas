import { Injectable } from '@nestjs/common';
import { Database, type AccessContext, type AccessContextLoader, type TenantRecord } from '../core';
import { ConfigurationService } from '../modules/configuration';
import { AuthzService } from '../modules/iam';

/**
 * Composition-root adapter for the core AccessContextLoader port: combines iam (who, which
 * permissions) and configuration (features, policy). One tenant transaction per request: one
 * set_config round-trip, two version reads, everything else from the versioned caches.
 */
@Injectable()
export class AccessContextLoaderImpl implements AccessContextLoader {
  constructor(
    private readonly db: Database,
    private readonly authz: AuthzService,
    private readonly config: ConfigurationService,
  ) {}

  async load(tenant: TenantRecord, userId: string): Promise<AccessContext | null> {
    return this.db.transaction(async () => {
      const access = await this.authz.userAccess(userId);
      if (!access) return null;
      const config = await this.config.effective(tenant.plan);
      return {
        tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, plan: tenant.plan },
        user: access.user,
        permissions: access.permissions,
        features: config.features,
        policy: config.policy,
      };
    });
  }
}
