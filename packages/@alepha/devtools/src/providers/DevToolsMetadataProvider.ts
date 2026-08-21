import { $inject, Alepha, type ZObject, type ZType, z } from "alepha";
import { $storage } from "alepha/api/files";
import { JobProvider } from "alepha/api/jobs";
import { $cache } from "alepha/cache";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import {
  PG_CREATED_AT,
  PG_DEFAULT,
  PG_DELETED_AT,
  PG_IDENTITY,
  PG_PRIMARY_KEY,
  PG_REF,
  PG_UPDATED_AT,
  PG_VERSION,
  RepositoryProvider,
} from "alepha/orm";
import { $page } from "alepha/react/router";
import { $issuer, SecurityProvider } from "alepha/security";
import { $action, ServerProvider } from "alepha/server";
import { $topic } from "alepha/topic";

import type { DevActionMetadata } from "../schemas/DevActionMetadata.ts";
import type { DevAtomMetadata } from "../schemas/DevAtomMetadata.ts";
import type { DevCacheMetadata } from "../schemas/DevCacheMetadata.ts";
import type {
  DevEntityColumn,
  DevEntityConstraint,
  DevEntityForeignKey,
  DevEntityIndex,
  DevEntityMetadata,
} from "../schemas/DevEntityMetadata.ts";
import type { DevEnvMetadata } from "../schemas/DevEnvMetadata.ts";
import type { DevJobMetadata } from "../schemas/DevJobMetadata.ts";
import type { DevMetadata, DevSystem } from "../schemas/DevMetadata.ts";
import type { DevModuleMetadata } from "../schemas/DevModuleMetadata.ts";
import type { DevPageMetadata } from "../schemas/DevPageMetadata.ts";
import type { DevPermissionMetadata } from "../schemas/DevPermissionMetadata.ts";
import type { DevProviderMetadata } from "../schemas/DevProviderMetadata.ts";
import type { DevRealmMetadata } from "../schemas/DevRealmMetadata.ts";
import type { DevRoleMetadata } from "../schemas/DevRoleMetadata.ts";
import type { DevStorageMetadata } from "../schemas/DevStorageMetadata.ts";
import type { DevTopicMetadata } from "../schemas/DevTopicMetadata.ts";

export class DevToolsMetadataProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly log = $logger();
  protected readonly serverProvider = $inject(ServerProvider);
  protected readonly startedAt = this.dateTime.nowMillis();

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
        body: this.toJsonSchema(schema?.body),
        params: this.toJsonSchema(schema?.params),
        query: this.toJsonSchema(schema?.query),
        response: this.toJsonSchema(schema?.response),
        bodyContentType: action.getBodyContentType(),
        middlewares: action.middlewares.filter(Boolean).length
          ? action.middlewares.filter(Boolean)
          : undefined,
      };
    });
  }

  /**
   * Jobs declared with `$job`.
   *
   * Declarative only. Execution counts, last-run and the rows themselves are
   * runtime state and come from `GET /__devtools/api/jobs`, which reads the
   * durable outbox table via `JobService`.
   */
  public getJobs(): DevJobMetadata[] {
    let registrations: Array<{ name: string; options: any; kind: string }>;
    try {
      registrations = Array.from(
        this.alepha.inject(JobProvider).getRegisteredJobs().values(),
      );
    } catch {
      // An app that never loaded the jobs module has no JobProvider to
      // inject, and the container refuses to register one after start. Degrade
      // to an empty list — the whole /metadata response 500s otherwise.
      return [];
    }

    return registrations.map(({ name, options }) => {
      const mode: DevJobMetadata["mode"] = options.cron
        ? "cron"
        : options.schema
          ? "queue"
          : "direct";

      return {
        name,
        description: options.description,
        mode,
        cron: options.cron,
        priority: options.priority,
        // Durations are declared as a `[value, unit]` tuple; stringifying one
        // directly yields "30,seconds".
        timeout: Array.isArray(options.timeout)
          ? options.timeout.join(" ")
          : options.timeout
            ? String(options.timeout)
            : undefined,
        retries: options.retry?.retries,
        lock: options.lock,
        record: options.record,
        schema: this.toJsonSchema(options.schema),
      };
    });
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
          schema: this.toJsonSchema(topic.options.schema),
          provider: this.getProviderName(topic.options.provider),
          subscribers: 1,
        });
      }
    }
    return Array.from(topicMap.values());
  }

  /**
   * File storages declared with `$storage`, including the default retention
   * (`ttl`) that only exists because storages are database-backed.
   */
  public getStorages(): DevStorageMetadata[] {
    return this.alepha.primitives($storage).map((storage) => ({
      name: storage.name,
      description: storage.options.description,
      mimeTypes: storage.options.mimeTypes,
      maxSize: storage.options.maxSize,
      ttl: storage.options.ttl
        ? this.dateTime.duration(storage.options.ttl).toISOString()
        : undefined,
      provider: this.getProviderName(storage.options.provider),
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

  /**
   * Every permission declared with `$permission`, flattened to `group:name`.
   *
   * `SecurityProvider` is the registry both `$permission` and `$role` write
   * into, so reading it here is the same list the guards consult — not a
   * re-scan of primitives that could drift from it.
   */
  public getPermissions(): DevPermissionMetadata[] {
    const security = this.getSecurityProvider();
    if (!security) return [];

    return security.getPermissions().map((permission) => ({
      name: permission.name,
      group: permission.group,
      description: permission.description,
      id: security.permissionToString(permission),
    }));
  }

  /**
   * Every role, with its grants resolved against the permission registry.
   *
   * `effective` and `viaWildcard` are computed here rather than in the browser
   * because `SecurityProvider.can()` owns the wildcard and `exclude` matching
   * rules. A second implementation in the UI would be free to disagree with
   * the one that actually authorizes requests, which is the exact bug this
   * screen exists to catch.
   */
  public getRoles(): DevRoleMetadata[] {
    const security = this.getSecurityProvider();
    if (!security) return [];

    const permissions = security.getPermissions();

    return security.getRealms().flatMap((realm) =>
      realm.roles.map((role) => {
        const literal = new Set(
          role.permissions
            .map((grant) => grant.name)
            .filter((name) => !name.includes("*")),
        );

        const effective: string[] = [];
        const viaWildcard: string[] = [];

        for (const permission of permissions) {
          const id = security.permissionToString(permission);
          if (!security.can(role.name, permission)) continue;
          effective.push(id);
          if (!literal.has(id)) viaWildcard.push(id);
        }

        return {
          name: role.name,
          description: role.description,
          realm: realm.name,
          default: role.default,
          grants: role.permissions.map((grant) => ({
            name: grant.name,
            ownership: grant.ownership,
            exclude: grant.exclude,
          })),
          effective,
          viaWildcard,
        };
      }),
    );
  }

  /**
   * `SecurityProvider` only exists once the security module is registered. An
   * app without it must still get a `/metadata` response, so resolve it
   * defensively — the container refuses to register providers after start and
   * would throw instead.
   */
  protected getSecurityProvider(): SecurityProvider | undefined {
    try {
      return this.alepha.inject(SecurityProvider);
    } catch {
      return undefined;
    }
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
        params: this.toJsonSchema(page.options.schema?.params),
        query: this.toJsonSchema(page.options.schema?.query),
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
        const schema = entity.schema as ZObject;
        const options = entity.options;

        // Resolved once per entity: the JSON Schema is the reliable source for
        // column types, while the raw zod fields still carry the PG_* symbols
        // that describe key/audit roles.
        const jsonProperties: Record<string, any> =
          this.toJsonSchema(entity.schema)?.properties ?? {};

        // Extract columns from schema
        const columns: DevEntityColumn[] = Object.entries(
          z.schema.shape(schema),
        ).map(([name, field]) => {
          const fieldSchema = field as ZType & Record<symbol, any>;
          const refData = fieldSchema[PG_REF];
          const jsonProp = jsonProperties[name];

          return {
            name,
            type:
              this.columnTypeFromJsonSchema(jsonProp) ??
              this.getColumnType(fieldSchema),
            nullable:
              this.isNullableFromJsonSchema(jsonProp) ||
              this.isNullable(fieldSchema),
            primaryKey: PG_PRIMARY_KEY in fieldSchema,
            identity: PG_IDENTITY in fieldSchema,
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
          schema: this.toJsonSchema(entity.schema),
          insertSchema: this.toJsonSchema(entity.insertSchema),
          updateSchema: this.toJsonSchema(entity.updateSchema),
        };
      });
    } catch {
      // RepositoryProvider not available (ORM not used)
      return [];
    }
  }

  /**
   * Resolve a column's type from its published JSON Schema.
   *
   * Preferred over the zod guards below because JSON Schema has already
   * normalised the wrappers. `.optional()`, `.default()` and `.nullable()`
   * each produce a distinct zod wrapper that `z.schema.isString(...)` and
   * friends return false for, so every wrapped column resolved to "unknown" —
   * which is why `deletedAt`, `priority`, `ip` and many others rendered
   * untyped in both the Schema panel and the Rows grid.
   *
   * Returns `undefined` when the shape is genuinely unrecognised, so the
   * caller can fall back.
   */
  protected columnTypeFromJsonSchema(prop: any): string | undefined {
    if (!prop || typeof prop !== "object") return undefined;

    const union = prop.anyOf ?? prop.oneOf;
    if (Array.isArray(union)) {
      const nonNull = union.filter((p: any) => p?.type !== "null");
      if (nonNull.length === 1)
        return this.columnTypeFromJsonSchema(nonNull[0]);
    }

    let type = prop.type;
    if (Array.isArray(type)) {
      type = type.find((t: string) => t !== "null");
    }

    if (Array.isArray(prop.enum)) return "enum";
    if (type === "array") return "array";
    if (type === "object" || prop.properties) return "json";
    if (type === "integer") return "integer";
    if (type === "number") return "number";
    if (type === "boolean") return "boolean";
    if (type === "string") {
      switch (prop.format) {
        case "uuid":
          return "uuid";
        case "date-time":
          return "datetime";
        case "date":
          return "date";
        case "email":
          return "email";
        case "bigint":
          return "bigint";
        default:
          return "text";
      }
    }
    return undefined;
  }

  /**
   * Nullability from JSON Schema — `anyOf: [T, {type:"null"}]` or
   * `type: [T, "null"]`.
   */
  protected isNullableFromJsonSchema(prop: any): boolean {
    if (!prop || typeof prop !== "object") return false;
    if (Array.isArray(prop.type) && prop.type.includes("null")) return true;
    const union = prop.anyOf ?? prop.oneOf;
    return Array.isArray(union) && union.some((p: any) => p?.type === "null");
  }

  protected getColumnType(field: ZType): string {
    // Handle optional/nullable wrappers (unions with null)
    if (z.schema.isUnion(field)) {
      const types = z.schema.options(field);
      const nonNull = types.find((type) => !z.schema.isNull(type));
      if (nonNull) {
        return this.getColumnType(nonNull);
      }
    }

    const f = field as any;

    // Check for enum (z.enum wraps in Unsafe with type=string and enum array)
    if (
      z.schema.isUnsafe(field) &&
      f.type === "string" &&
      Array.isArray(f.enum)
    ) {
      return "enum";
    }

    // Use TypeBox's type guards
    if (z.schema.isString(field)) {
      if (f.enum) return "enum";
      if (f.format === "uuid") return "uuid";
      if (f.format === "date-time") return "datetime";
      if (f.format === "date") return "date";
      if (f.format === "bigint") return "bigint";
      return "text";
    }
    if (z.schema.isInteger(field)) return "integer";
    if (z.schema.isNumber(field)) return "number";
    if (z.schema.isBoolean(field)) return "boolean";
    if (z.schema.isArray(field)) return "array";
    if (z.schema.isObject(field)) return "json";
    if (z.schema.isLiteral(field)) return "literal";

    return "unknown";
  }

  protected isNullable(field: ZType): boolean {
    if (z.schema.isUnion(field)) {
      const types = z.schema.options(field);
      return types.some((type) => z.schema.isNull(type));
    }
    return false;
  }

  public getEnvs(): DevEnvMetadata[] {
    const envSchemas = this.alepha.getEnvSchemas();

    return envSchemas.map((item, index) => ({
      propertyKey: `env_${index}`,
      schema: this.toJsonSchema(item.schema),
      values: item.values,
      serviceName: item.owner?.service,
      moduleName: item.owner?.module,
    }));
  }

  public getAtoms(): DevAtomMetadata[] {
    const atomsWithValues = this.alepha.store.getAtoms(false);

    // `serverOnly` is reported but not acted on here. The flag keeps a value
    // out of the *application's* SSR hydration payload; it is not a general
    // secrecy marker, and devtools is not the application. This module refuses
    // to register in production precisely because it already serves the whole
    // environment — every secret in it — in cleartext, and its atom route
    // already lets you write these same atoms. Redacting the read while
    // permitting the write left the one screen that exists to show server
    // state unable to show it.
    return atomsWithValues.map(({ atom, value }) => {
      return {
        name: atom.key,
        description: atom.options.description,
        schema: this.toJsonSchema(atom.schema),
        defaultValue: atom.options.default,
        currentValue: value,
        serverOnly: atom.options.serverOnly,
        persist: (atom.options as any).persist,
      };
    });
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
      uptime: (this.dateTime.nowMillis() - this.startedAt) / 1000,
      memoryUsage: process.memoryUsage?.()?.heapUsed ?? 0,
    };
  }

  public getMetadata(): DevMetadata {
    return {
      system: this.getSystem(),
      actions: this.getActions(),
      jobs: this.getJobs(),
      topics: this.getTopics(),
      storages: this.getStorages(),
      realms: this.getRealms(),
      roles: this.getRoles(),
      permissions: this.getPermissions(),
      caches: this.getCaches(),
      pages: this.getPages(),
      providers: this.getProviders(),
      modules: this.getModules(),
      entities: this.getEntities(),
      envs: this.getEnvs(),
      atoms: this.getAtoms(),
    };
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Publish a schema as JSON Schema.
   *
   * Every `schema`-ish field on the devtools metadata is typed `z.any()`, so a
   * raw zod schema handed straight to the response serializes as zod's own
   * internals (`{ def, type, shape, checks }`) instead of JSON Schema. Every
   * consumer reads JSON Schema: the UI renders `properties`, and
   * `jsonSchemaToZod` — written for exactly this round trip — rebuilds a zod
   * schema for the Try It / record-editor forms. Without this conversion the
   * schema panes render zod plumbing and every generated form comes up empty.
   *
   * Unrepresentable schemas fall back to `undefined` rather than throwing, so
   * one exotic action can't take down the whole metadata response.
   */
  protected toJsonSchema(source?: unknown): any {
    if (!source) {
      return undefined;
    }
    try {
      const json: any = z.toJSONSchema(source as any);
      // The dialect URL is noise for consumers that only read the shape.
      json.$schema = undefined;
      return json;
    } catch {
      return undefined;
    }
  }

  protected getProviderName(provider?: any): string {
    if (!provider) {
      return "default";
    }
    if (provider === "memory") {
      return "memory";
    }
    return provider.name || "custom";
  }
}
