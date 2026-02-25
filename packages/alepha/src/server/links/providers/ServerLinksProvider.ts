import { createHash } from "node:crypto";
import { $hook, $inject, $use, Alepha, AlephaError, t } from "alepha";
import { $logger } from "alepha/logger";
import type { SecurityProvider, UserAccountToken } from "alepha/security";
import {
  $action,
  $route,
  type ClientRequestEntry,
  type ClientRequestOptions,
  type RequestConfigSchema,
  ServerTimingProvider,
  serverApiOptions,
} from "alepha/server";
import type { ApiRegistryResponse } from "../schemas/apiLinksResponseSchema.ts";
import { DefinitionsPool } from "../services/DefinitionsPool.ts";
import { LinkProvider } from "./LinkProvider.ts";
import { RemotePrimitiveProvider } from "./RemotePrimitiveProvider.ts";

export class ServerLinksProvider {
  protected readonly serverApi = $use(serverApiOptions);
  protected readonly alepha = $inject(Alepha);
  protected readonly linkProvider = $inject(LinkProvider);
  protected readonly remoteProvider = $inject(RemotePrimitiveProvider);
  protected readonly serverTimingProvider = $inject(ServerTimingProvider);
  protected readonly log = $logger();

  /**
   * Resolved once on start. Undefined when alepha/security is not loaded.
   */
  protected securityProvider: SecurityProvider | undefined;

  /**
   * Cache of serialized JSON by role key.
   * Key = sorted roles joined by comma (empty string for unauthenticated).
   */
  protected registryCache = new Map<string, RegistryCacheEntry>();

  public get prefix() {
    return this.serverApi.prefix;
  }

  public readonly onRoute = $hook({
    on: "configure",
    handler: () => {
      // convert all $action to local links
      for (const action of this.alepha.primitives($action)) {
        const bodyContentType = action.getBodyContentType();

        this.linkProvider.registerLink({
          name: action.name,
          group: action.group,
          schema: action.options.schema,
          contentType:
            bodyContentType && bodyContentType !== "application/json"
              ? bodyContentType
              : undefined,
          secured: action.middlewares.some((m) => m?.name === "$secure")
            ? (action.middlewares.find((m) => m?.name === "$secure")?.options ??
              true)
            : undefined,
          method: action.method === "GET" ? undefined : action.method,
          prefix: action.prefix,
          path: action.path,
          // by local, we mean that it can be called directly via the handler
          handler: (
            config: ClientRequestEntry<RequestConfigSchema>,
            options: ClientRequestOptions = {},
          ) => action.run(config, options),
        });
      }
    },
  });

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      try {
        this.securityProvider =
          this.alepha.inject<SecurityProvider>("SecurityProvider");
      } catch {
        this.log.debug(
          "Security module is not loaded — permission checks are disabled",
        );
      }
    },
  });

  /**
   * API registry endpoint — returns all available actions for the user.
   *
   * Response is filtered by the user's permissions.
   * Cached by role set with ETag support.
   */
  public readonly links = $route({
    path: LinkProvider.path.apiLinks,
    handler: async ({ user, headers, reply }) => {
      const roleKey = user?.roles?.slice().sort().join(",") ?? "";
      const cached = this.registryCache.get(roleKey);

      if (cached) {
        // ETag match → 304
        if (headers["if-none-match"] === cached.etag) {
          reply.setStatus(304);
          reply.setHeader("etag", cached.etag);
          return;
        }

        reply.setHeader("etag", cached.etag);
        reply.setHeader("content-type", "application/json");
        reply.body = cached.json;
        return;
      }

      // Cache miss — compute, serialize, cache
      const response = await this.getUserApiLinks({
        user,
        authorization: headers.authorization,
      });
      const json = JSON.stringify(response);
      const etag = `"${createHash("md5").update(json).digest("hex")}"`;

      this.registryCache.set(roleKey, { json, etag });

      reply.setHeader("etag", etag);
      reply.setHeader("content-type", "application/json");
      reply.body = json;
    },
  });

  /**
   * Batch endpoint — execute multiple actions in a single HTTP request.
   * Each sub-request is independent: errors in one don't affect others.
   */
  public readonly batch = $route({
    method: "POST",
    path: "/api/_batch",
    schema: {
      body: t.array(
        t.object({
          action: t.text(),
          params: t.optional(t.record(t.text(), t.any())),
          query: t.optional(t.record(t.text(), t.any())),
          body: t.optional(t.record(t.text(), t.any())),
        }),
      ),
      response: t.array(
        t.object({
          action: t.text(),
          status: t.integer(),
          data: t.optional(t.any()),
          error: t.optional(t.text()),
        }),
      ),
    },
    handler: async ({ body }) => {
      if (body.length > ServerLinksProvider.MAX_BATCH_SIZE) {
        throw new AlephaError(
          `Batch size ${body.length} exceeds maximum of ${ServerLinksProvider.MAX_BATCH_SIZE}`,
        );
      }

      const results = await Promise.allSettled(
        body.map((entry) =>
          this.linkProvider.follow(entry.action, {
            params: entry.params as any,
            query: entry.query as any,
            body: entry.body as any,
          }),
        ),
      );

      return results.map((result, i) => {
        const action = body[i].action;

        if (result.status === "fulfilled") {
          return { action, status: 200, data: result.value };
        }

        const reason = result.reason;
        const status = reason?.status ?? 500;
        const message = reason?.message ?? "Internal error";

        this.log.warn("Batch action failed", {
          action,
          status,
          message,
          error: reason,
        });

        return { action, status, error: message };
      });
    },
  });

  protected static readonly MAX_BATCH_SIZE = 20;

  /**
   * Retrieves API registry for the user based on their permissions.
   * Will check on local links and remote links.
   */
  public async getUserApiLinks(
    options: GetApiLinksOptions,
  ): Promise<ApiRegistryResponse> {
    const { user } = options;
    const { securityProvider } = this;
    const securityPermissions =
      securityProvider && user
        ? securityProvider.getPermissions(user)
        : undefined;

    const pool = new DefinitionsPool();
    const actions: Record<string, any> = {};
    const permissions: string[] = [];

    // Collect permissions not related to $action (virtual permissions)
    for (const permission of securityPermissions ?? []) {
      if (
        !permission.path &&
        !permission.method &&
        permission.name &&
        permission.group
      ) {
        permissions.push(`${permission.group}:${permission.name}`);
      }
    }

    // Add local links
    for (const link of this.linkProvider.getServerLinks()) {
      // SKIP REMOTE LINKS, remote links are handled separately for security
      if (link.host) continue;

      if (securityProvider && link.secured) {
        // skip secured links if user is not provided
        if (!user) {
          continue;
        }

        if (typeof link.secured === "object") {
          // issuer check
          if (
            link.secured.issuers?.length &&
            (!user.realm || !link.secured.issuers.includes(user.realm))
          ) {
            continue;
          }

          // role check
          if (link.secured.roles?.length) {
            const hasRole = link.secured.roles.some((role: string) =>
              user.roles?.includes(role),
            );
            if (!hasRole) continue;
          }

          // explicit permission check
          if (link.secured.permissions?.length) {
            const perms = link.secured.permissions;

            let allowed = true;
            for (const perm of perms) {
              const result = securityProvider.checkPermission(
                perm,
                ...(user.roles ?? []),
              );
              if (!result.isAuthorized) {
                allowed = false;
                break;
              }
            }
            if (!allowed) continue;
          }
        }
        // link.secured === true → auth only, user is already checked above
      }

      actions[link.name] = {
        path: link.path,
        method: link.method || undefined,
        body: pool.ref(link.schema?.body),
        response: pool.ref(link.schema?.response),
        contentType: link.contentType,
        service: link.service,
      };
    }

    this.serverTimingProvider.beginTiming("fetchRemoteLinks");
    // TODO: remote links can be cached by user.roles
    const remoteResults = await Promise.all(
      this.remoteProvider
        .getRemotes()
        .filter((it) => it.proxy) // add only "proxy" remotes
        .map(async (remote) => {
          const registry = await remote.links(options);
          return { remote, registry };
        }),
    );

    for (const { remote, registry } of remoteResults) {
      const remotePrefix = registry.prefix ?? "/api";

      // Merge remote definitions into our pool
      const remoteDefMap = new Map<string, string>();
      if (registry.definitions) {
        for (const [refKey, jsonString] of Object.entries(
          registry.definitions,
        )) {
          const schema = JSON.parse(jsonString);
          const newRef = pool.ref(schema);
          if (newRef) {
            remoteDefMap.set(refKey, newRef);
          }
        }
      }

      // Merge remote actions
      for (const [name, action] of Object.entries(registry.actions)) {
        let path = action.path.replace(remotePrefix, "");
        if (action.service) {
          path = `/${action.service}${path}`;
        }

        actions[name] = {
          path,
          method: action.method,
          body: action.body
            ? (remoteDefMap.get(action.body) ?? action.body)
            : undefined,
          response: action.response
            ? (remoteDefMap.get(action.response) ?? action.response)
            : undefined,
          contentType: action.contentType,
          service: remote.name,
        };
      }

      // Merge remote permissions
      if (registry.permissions) {
        permissions.push(...registry.permissions);
      }
    }

    this.serverTimingProvider.endTiming("fetchRemoteLinks");

    const definitions = pool.toJSON();

    return {
      prefix: this.serverApi.prefix,
      definitions:
        Object.keys(definitions).length > 0 ? definitions : undefined,
      actions,
      permissions: permissions.length > 0 ? permissions : undefined,
    };
  }
}

export interface GetApiLinksOptions {
  user?: UserAccountToken;
  authorization?: string;
}

interface RegistryCacheEntry {
  json: string;
  etag: string;
}
