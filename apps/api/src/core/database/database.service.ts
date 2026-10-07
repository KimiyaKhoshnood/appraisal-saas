import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../../generated/prisma/client';
import { ENV, type Env } from '../config/env';
import { MissingTenantContextError, TenantContext } from '../context/request-context';
import { TENANT_MODELS, scopeArgs } from './tenant-scope';

export interface DatabaseOptions {
  url: string;
  poolMax: number;
  statementTimeoutMs: number;
  /** Layer 2 (automatic tenant predicates). Only experiment E1 v2 turns it off. */
  appFilter: boolean;
}

function setTenantSql(base: PrismaClient, tenantId: string, statementTimeoutMs: number) {
  // `is_local = true`: the setting dies with the transaction, so a pooled connection can never
  // carry one request's tenant into the next (T3). Never `SET app.tenant_id` at session level.
  return base.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true),
                                 set_config('statement_timeout', ${String(statementTimeoutMs)}, true)`;
}

export function createClients(opts: DatabaseOptions) {
  const base = new PrismaClient({
    adapter: new PrismaPg({ connectionString: opts.url, max: opts.poolMax }),
    // Every tenant operation is a (short) transaction, so the wait for a pooled connection is
    // the queueing time under load; Prisma's 2 s default fails bursts that a 10-connection pool
    // absorbs fine. Measured in experiment E3.
    transactionOptions: { maxWait: 10_000, timeout: 15_000 },
  });

  const extended = base.$extends({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);

          // Layer 1: no tenant in context → refuse before touching the database.
          const store = TenantContext.current();
          const tenantId = store?.tenantId;
          if (!tenantId) throw new MissingTenantContextError(`${model}.${operation} requires a tenant context`);

          // Layer 2: add tenant predicates / stamp tenant_id on writes.
          const scoped = opts.appFilter
            ? (scopeArgs(model, operation, args as Record<string, unknown>, tenantId) as typeof args)
            : args;

          // Inside Database.transaction the tenant setting is already applied to this connection.
          if (store.tx) return query(scoped);

          // Single operation: wrap it in a two-statement transaction so RLS sees the tenant (layer 3).
          const [, result] = await base.$transaction([
            setTenantSql(base, tenantId, opts.statementTimeoutMs),
            query(scoped) as Prisma.PrismaPromise<unknown>,
          ]);
          return result;
        },
      },
    },
  });

  return { base, extended };
}

export type ExtendedClient = ReturnType<typeof createClients>['extended'];
/** What repositories receive: the extended client or the current interactive transaction. */
export type Db = Omit<ExtendedClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

export interface TransactionOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  timeoutMs?: number;
}

@Injectable()
export class Database implements OnModuleDestroy {
  private readonly logger = new Logger(Database.name);
  readonly base: PrismaClient;
  private readonly extended: ExtendedClient;
  private readonly statementTimeoutMs: number;

  constructor(@Inject(ENV) env: Env) {
    const opts: DatabaseOptions = {
      url: env.DATABASE_URL,
      poolMax: env.DB_POOL_MAX,
      statementTimeoutMs: env.STATEMENT_TIMEOUT_MS,
      appFilter: env.TENANCY_APP_FILTER === 'on',
    };
    if (!opts.appFilter) this.logger.warn('TENANCY_APP_FILTER=off: isolation relies on RLS alone (experiment mode)');
    const { base, extended } = createClients(opts);
    this.base = base;
    this.extended = extended;
    this.statementTimeoutMs = opts.statementTimeoutMs;
  }

  /** The client to use right now: the ambient transaction if there is one. */
  get client(): Db {
    return (TenantContext.current()?.tx as Db | undefined) ?? this.extended;
  }

  get inTransaction(): boolean {
    return Boolean(TenantContext.current()?.tx);
  }

  /**
   * Runs `fn` in one interactive transaction bound to the current tenant. Nested calls join the
   * outer transaction, so a service can compose others without thinking about it; the domain
   * change and its audit record (ADR-009) always commit or roll back together.
   */
  async transaction<T>(fn: (tx: Db) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    const store = TenantContext.current();
    if (store?.tx) return fn(store.tx as Db);
    const tenantId = TenantContext.requireTenantId();

    return this.extended.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true),
                                    set_config('statement_timeout', ${String(this.statementTimeoutMs)}, true)`;
        const child = { ...store!, tx };
        // `await` *inside* the scope: Prisma promises are lazy, and a callback that returns one
        // unawaited would otherwise be executed after the scope ends, outside this transaction.
        return TenantContext.run(child, async () => await fn(tx as unknown as Db));
      },
      {
        isolationLevel: options.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: options.timeoutMs ?? 15_000,
        maxWait: 10_000,
      },
    );
  }

  /** Transaction over platform tables only (no tenant). Tenant models inside it are refused. */
  async platformTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    const store = TenantContext.current();
    return this.extended.$transaction(
      async (tx) => {
        const child = {
          requestId: store?.requestId ?? 'system',
          ip: store?.ip ?? null,
          actor: store?.actor ?? { type: 'SYSTEM' as const, id: null, name: null },
          access: null,
          tenantId: null,
          tx,
        };
        return TenantContext.run(child, async () => await fn(tx as unknown as Db));
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
  }

  async onModuleDestroy() {
    await this.base.$disconnect();
  }
}
