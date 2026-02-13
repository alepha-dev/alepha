import { $inject, Alepha, type TObject, type TSchema, t } from "alepha";
import { $bucket } from "alepha/bucket";
import { $cache } from "alepha/cache";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import {
  PG_CREATED_AT,
  PG_DEFAULT,
  PG_DELETED_AT,
  PG_IDENTITY,
  PG_PRIMARY_KEY,
  PG_REF,
  PG_SERIAL,
  PG_UPDATED_AT,
  PG_VERSION,
  RepositoryProvider,
} from "alepha/orm";
import { $queue } from "alepha/queue";
import { $page } from "alepha/react/router";
import { $scheduler } from "alepha/scheduler";
import { $issuer } from "alepha/security";
import { $action, ServerProvider } from "alepha/server";
import { $topic } from "alepha/topic";
import type { DevActionMetadata } from "../schemas/DevActionMetadata.ts";
import type { DevAtomMetadata } from "../schemas/DevAtomMetadata.ts";
import type { DevBucketMetadata } from "../schemas/DevBucketMetadata.ts";
import type { DevCacheMetadata } from "../schemas/DevCacheMetadata.ts";
import type { DevCommandMetadata } from "../schemas/DevCommandMetadata.ts";
import type {
  DevEntityColumn,
  DevEntityConstraint,
  DevEntityForeignKey,
  DevEntityIndex,
  DevEntityMetadata,
} from "../schemas/DevEntityMetadata.ts";
import type { DevEnvMetadata } from "../schemas/DevEnvMetadata.ts";
import type { DevMetadata, DevSystem } from "../schemas/DevMetadata.ts";
import type { DevModuleMetadata } from "../schemas/DevModuleMetadata.ts";
import type { DevPageMetadata } from "../schemas/DevPageMetadata.ts";
import type { DevProviderMetadata } from "../schemas/DevProviderMetadata.ts";
import type { DevQueueMetadata } from "../schemas/DevQueueMetadata.ts";
import type { DevRealmMetadata } from "../schemas/DevRealmMetadata.ts";
import type { DevRouteMetadata } from "../schemas/DevRouteMetadata.ts";
import type { DevSchedulerMetadata } from "../schemas/DevSchedulerMetadata.ts";
import type { DevTopicMetadata } from "../schemas/DevTopicMetadata.ts";

export class DevToolsMetadataProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly serverProvider = $inject(ServerProvider);
  protected readonly startedAt = Date.now();

  public getActions(): DevActionMetadata[] {
    const actionPrimitives = this.alepha.primitives($action);

    return actionPrimitives.map((action) => {
      const schema = action.schema;
      const options = action.options as any; // Allow accessing augmented properties

      return {
        name: action.name,
        group: action.group,
        method: action.method,
        path: action.path,
        prefix: action.prefix,
        fullPath: action.route.path,
        description: action.options.description,
        summary: options.summary,
        disabled: action.options.disabled,
        secure:
          action.middlewares.some((m) => m?.name === "$secure") || undefined,
        hide: options.hide,
        body: schema?.body,
        params: schema?.params,
        query: schema?.query,
        response: schema?.response,
        bodyContentType: action.getBodyContentType(),
        middlewares: action.middlewares.filter(Boolean).length
          ? action.middlewares.filter(Boolean)
          : undefined,
      };
    });
  }

  public getQueues(): DevQueueMetadata[] {
    const queuePrimitives = this.alepha.primitives($queue);

    return queuePrimitives.map((queue) => ({
      name: queue.name,
      description: queue.options.description,
      schema: queue.options.schema,
      provider: this.getProviderName(queue.options.provider),
    }));
  }

  public getSchedulers(): DevSchedulerMetadata[] {
    const schedulerPrimitives = this.alepha.primitives($scheduler);

    return schedulerPrimitives.map((scheduler) => ({
      name: scheduler.name,
      description: scheduler.options.description,
      cron: scheduler.options.cron,
      interval: scheduler.options.interval,
      lock: scheduler.options.lock,
    }));
  }

  public getTopics(): DevTopicMetadata[] {
    const topicPrimitives = this.alepha.primitives($topic);

    // Deduplicate by name, count subscribers
    const topicMap = new Map<string, DevTopicMetadata>();
    for (const topic of topicPrimitives) {
      const existing = topicMap.get(topic.name);
      if (existing) {
        existing.subscribers++;
      } else {
        topicMap.set(topic.name, {
          name: topic.name,
          description: topic.options.description,
          schema: topic.options.schema,
          provider: this.getProviderName(topic.options.provider),
          subscribers: 1,
        });
      }
    }
    return Array.from(topicMap.values());
  }

  public getBuckets(): DevBucketMetadata[] {
    const bucketPrimitives = this.alepha.primitives($bucket);

    return bucketPrimitives.map((bucket) => ({
      name: bucket.name,
      description: bucket.options.description,
      mimeTypes: bucket.options.mimeTypes,
      maxSize: bucket.options.maxSize,
      provider: this.getProviderName(bucket.options.provider),
    }));
  }

  public getRealms(): DevRealmMetadata[] {
    const realmPrimitives = this.alepha.primitives($issuer);

    return realmPrimitives.map((realm) => ({
      name: realm.name,
      description: realm.options.description,
      roles: realm.options.roles,
      type: "secret" in realm.options ? "internal" : "external",
      settings: {
        accessTokenExpiration: realm.options.settings?.accessToken?.expiration,
        refreshTokenExpiration:
          realm.options.settings?.refreshToken?.expiration,
        hasOnCreateSession: !!realm.options.settings?.onCreateSession,
        hasOnRefreshSession: !!realm.options.settings?.onRefreshSession,
        hasOnDeleteSession: !!realm.options.settings?.onDeleteSession,
      },
    }));
  }

  public getCaches(): DevCacheMetadata[] {
    const cachePrimitives = this.alepha.primitives($cache);

    return cachePrimitives.map((cache) => ({
      name: cache.container,
      ttl: cache.options.ttl,
      disabled: cache.options.disabled,
      provider: this.getProviderName(cache.options.provider),
    }));
  }

  public getPages(): DevPageMetadata[] {
    const pagePrimitives = this.alepha.primitives($page);

    return pagePrimitives.map((page: any) => {
      // Resolve children (can be an array or a function returning an array)
      const children =
        typeof page.options.children === "function"
          ? page.options.children()
          : page.options.children;
      const childrenNames = Array.isArray(children)
        ? children.map((c: any) => c.name).filter(Boolean)
        : undefined;

      return {
        name: page.name,
        label: page.options.label,
        description: page.options.description,
        path: page.options.path,
        parentName: page.options.parent?.name,
        params: page.options.schema?.params,
        query: page.options.schema?.query,
        hasComponent: !!page.options.component,
        hasLazy: !!page.options.lazy,
        hasResolve: !!page.options.resolve,
        childrenNames: childrenNames?.length ? childrenNames : undefined,
        hasChildren: !!page.options.children,
        hasParent: !!page.options.parent,
        hasErrorHandler: !!page.options.errorHandler,
        static:
          typeof page.options.static === "boolean"
            ? page.options.static
            : !!page.options.static,
        cache: page.options.cache,
        client: page.options.client,
        animation: page.options.animation,
      };
    });
  }

  public getProviders(): DevProviderMetadata[] {
    const graph = this.alepha.graph();

    return Object.entries(graph).map(([name, info]) => ({
      name,
      module: info.module ?? name,
      dependencies: info.from,
      aliases: info.as,
    }));
  }

  public getModules(): DevModuleMetadata[] {
    const graph = this.alepha.graph();
    const moduleMap = new Map<string, Set<string>>();

    // Group providers by module
    for (const [providerName, info] of Object.entries(graph)) {
      if (info.module) {
        if (!moduleMap.has(info.module)) {
          moduleMap.set(info.module, new Set());
        }
        moduleMap.get(info.module)!.add(providerName);
      }
    }

    return Array.from(moduleMap.entries()).map(([name, providers]) => ({
      name,
      providers: Array.from(providers),
    }));
  }

  public getEntities(): DevEntityMetadata[] {
    try {
      const repositoryProvider = this.alepha.inject(RepositoryProvider);
      const repositories = repositoryProvider.getRepositories();

      return repositories.map((repo) => {
        const entity = repo.entity;
        const schema = entity.schema as TObject;
        const options = entity.options;

        // Extract columns from schema
        const columns: DevEntityColumn[] = Object.entries(
          schema.properties,
        ).map(([name, field]) => {
          const fieldSchema = field as TSchema & Record<symbol, any>;
          const refData = fieldSchema[PG_REF];

          return {
            name,
            type: this.getColumnType(fieldSchema),
            nullable: this.isNullable(fieldSchema),
            primaryKey: PG_PRIMARY_KEY in fieldSchema,
            identity: PG_IDENTITY in fieldSchema || PG_SERIAL in fieldSchema,
            createdAt: PG_CREATED_AT in fieldSchema,
            updatedAt: PG_UPDATED_AT in fieldSchema,
            deletedAt: PG_DELETED_AT in fieldSchema,
            version: PG_VERSION in fieldSchema,
            hasDefault: PG_DEFAULT in fieldSchema,
            ref: refData
              ? {
                  entity: refData.ref?.()?.entity?.name ?? "unknown",
                  column: refData.ref?.()?.name ?? "unknown",
                  onUpdate: refData.actions?.onUpdate,
                  onDelete: refData.actions?.onDelete,
                }
              : undefined,
          };
        });

        // Extract indexes
        const indexes: DevEntityIndex[] = (options.indexes ?? []).map(
          (idx: any) => {
            if (typeof idx === "string") {
              return { columns: [idx], unique: false };
            }
            return {
              name: idx.name,
              columns: idx.column ? [idx.column] : (idx.columns ?? []),
              unique: idx.unique ?? false,
            };
          },
        );

        // Extract foreign keys
        const foreignKeys: DevEntityForeignKey[] = (
          options.foreignKeys ?? []
        ).map((fk: any) => ({
          name: fk.name,
          columns: fk.columns.map(String),
          foreignEntity: fk.foreignColumns?.[0]?.()?.entity?.name ?? "unknown",
          foreignColumns: fk.foreignColumns?.map(
            (fc: any) => fc?.()?.name ?? "unknown",
          ),
        }));

        // Extract constraints
        const constraints: DevEntityConstraint[] = (
          options.constraints ?? []
        ).map((c: any) => ({
          name: c.name,
          columns: c.columns.map(String),
          unique: !!c.unique,
          hasCheck: !!c.check,
        }));

        return {
          name: entity.name,
          provider: repo.provider.constructor.name,
          columns,
          indexes,
          foreignKeys,
          constraints,
          schema: entity.schema,
          insertSchema: entity.insertSchema,
          updateSchema: entity.updateSchema,
        };
      });
    } catch {
      // RepositoryProvider not available (ORM not used)
      return [];
    }
  }

  protected getColumnType(field: TSchema): string {
    // Handle optional/nullable wrappers (unions with null)
    if (t.schema.isUnion(field) && (field as any).anyOf) {
      const types = (field as any).anyOf as TSchema[];
      const nonNull = types.find((type) => !t.schema.isNull(type));
      if (nonNull) {
        return this.getColumnType(nonNull);
      }
    }

    const f = field as any;

    // Check for enum (t.enum wraps in Unsafe with type=string and enum array)
    if (
      t.schema.isUnsafe(field) &&
      f.type === "string" &&
      Array.isArray(f.enum)
    ) {
      return "enum";
    }

    // Use TypeBox's type guards
    if (t.schema.isString(field)) {
      if (f.enum) return "enum";
      if (f.format === "uuid") return "uuid";
      if (f.format === "date-time") return "datetime";
      if (f.format === "date") return "date";
      if (f.format === "bigint") return "bigint";
      return "text";
    }
    if (t.schema.isInteger(field)) return "integer";
    if (t.schema.isNumber(field)) return "number";
    if (t.schema.isBoolean(field)) return "boolean";
    if (t.schema.isArray(field)) return "array";
    if (t.schema.isObject(field)) return "json";
    if (t.schema.isLiteral(field)) return "literal";

    return "unknown";
  }

  protected isNullable(field: TSchema): boolean {
    if (t.schema.isUnion(field) && (field as any).anyOf) {
      const types = (field as any).anyOf as TSchema[];
      return types.some((type) => t.schema.isNull(type));
    }
    return false;
  }

  public getCommands(): DevCommandMetadata[] {
    const commandPrimitives = this.alepha.primitives($command);

    return commandPrimitives
      .filter((cmd) => !cmd.options.hide)
      .map((command) => ({
        name: command.name,
        description: command.options.description,
        hidden: command.options.hide,
      }));
  }

  public getRoutes(): DevRouteMetadata[] {
    // Routes are the base primitive - actions and pages are routes
    // Showing them separately would be redundant with actions
    return [];
  }

  public getEnvs(): DevEnvMetadata[] {
    const envSchemas = this.alepha.getEnvSchemas();

    return envSchemas.map((item, index) => ({
      propertyKey: `env_${index}`,
      schema: item.schema,
      values: item.values,
      serviceName: undefined,
    }));
  }

  public getAtoms(): DevAtomMetadata[] {
    const atomsWithValues = this.alepha.store.getAtoms(false);

    return atomsWithValues.map(({ atom, value }) => ({
      name: atom.key,
      description: atom.options.description,
      schema: atom.schema,
      defaultValue: atom.options.default,
      currentValue: value,
    }));
  }

  public getSystem(): DevSystem {
    const isBun = typeof globalThis.Bun !== "undefined";
    const port = Number(this.alepha.env.SERVER_PORT) || 3000;
    return {
      alephaVersion: String(this.alepha.env.npm_package_version ?? "unknown"),
      nodeVersion: isBun
        ? (globalThis.Bun?.version ?? "unknown")
        : process.version,
      runtime: isBun ? "bun" : "node",
      mode: this.alepha.isProduction() ? "production" : "development",
      port,
      uptime: (Date.now() - this.startedAt) / 1000,
      memoryUsage: process.memoryUsage?.()?.rss ?? 0,
    };
  }

  public getMetadata(): DevMetadata {
    return {
      system: this.getSystem(),
      actions: this.getActions(),
      queues: this.getQueues(),
      schedulers: this.getSchedulers(),
      topics: this.getTopics(),
      buckets: this.getBuckets(),
      realms: this.getRealms(),
      caches: this.getCaches(),
      pages: this.getPages(),
      providers: this.getProviders(),
      modules: this.getModules(),
      entities: this.getEntities(),
      commands: this.getCommands(),
      routes: this.getRoutes(),
      envs: this.getEnvs(),
      atoms: this.getAtoms(),
    };
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected getProviderName(provider?: "memory" | any): string {
    if (!provider) {
      return "default";
    }
    if (provider === "memory") {
      return "memory";
    }
    return provider.name || "custom";
  }
}
