import { createHash } from "node:crypto";

import { $hook, $inject, $store, Alepha, z } from "alepha";
import { $logger } from "alepha/logger";
import type { SecurityProvider, UserAccountToken } from "alepha/security";
import {
  $action,
  $route,
  $sse,
  BadRequestError,
  type ClientRequestEntry,
  type ClientRequestOptions,
  type RequestConfigSchema,
  ServerTimingProvider,
  serverApiOptions,
} from "alepha/server";

import type { ApiRegistryResponse } from "../schemas/apiLinksResponseSchema.ts";
import { type HttpClientLink, LinkProvider } from "./LinkProvider.ts";
import { RemotePrimitiveProvider } from "./RemotePrimitiveProvider.ts";

export class ServerLinksProvider {
  protected readonly serverApi = $store(serverApiOptions);
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
   * Cache of serialized JSON by identity key (see {@link registryCacheKey}).
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

      // convert all $sse to local links
      for (const sse of this.alepha.primitives($sse)) {
        this.linkProvider.registerLink({
          name: sse.name,
          group: sse.group,
          kind: "sse",
          schema: {
            body: sse.schema?.body,
          },
          method: "POST",
          prefix: sse.prefix,
          path: sse.path,
          handler: async (config) => {
            return sse.run(config as any) as any;
          },
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
      const roleKey = this.registryCacheKey(user);
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
   * On-demand schemas endpoint — returns JSON Schemas for requested actions.
   *
   * Schemas are filtered by the user's permissions (same logic as the registry).
   */
  public readonly schemas = $route({
    method: "POST",
    path: "/api/_links/schemas",
    schema: {
      body: z.object({
        actions: z.array(z.text()),
      }),
      response: z.record(
        z.text(),
        z.object({
          body: z.string().optional(),
          response: z.string().optional(),
        }),
      ),
    },
    handler: async ({ body, user }) => {
      const result: Record<string, { body?: string; response?: string }> = {};

      for (const name of body.actions) {
        const link = this.linkProvider
          .getServerLinks()
          .find((l) => l.name === name && !l.host);

        if (!link) continue;
        if (!this.isLinkAccessible(link, user)) continue;

        const entry: { body?: string; response?: string } = {};
        if (link.schema?.body) {
          entry.body = JSON.stringify(link.schema.body);
        }
        if (link.schema?.response) {
          entry.response = JSON.stringify(link.schema.response);
        }
        result[name] = entry;
      }

      return result as any;
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
      body: z.array(
        z.object({
          action: z.text(),
          params: z.record(z.text(), z.any()).optional(),
          query: z.record(z.text(), z.any()).optional(),
          body: z.record(z.text(), z.any()).optional(),
        }),
      ),
      response: z.array(
        z.object({
          action: z.text(),
          status: z.integer(),
          data: z.any().optional(),
          error: z.text().optional(),
        }),
      ),
    },
    handler: async (request) => {
      const { body } = request;
      if (body.length > ServerLinksProvider.MAX_BATCH_SIZE) {
        // The caller sent too many entries — that is a bad request, not a
        // server fault. A bare AlephaError surfaced as a 500.
        throw new BadRequestError(
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

      const entries: Array<{
        action: string;
        status: number;
        data?: any;
        error?: string;
      }> = [];

      for (const [i, result] of results.entries()) {
        const action = body[i].action;

        if (result.status === "fulfilled") {
          entries.push({ action, status: 200, data: result.value });
          continue;
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

        await this.reportSubRequestError(request, action, reason);

        // Same rule the single-request path applies in `sendError`: a 5xx
        // message is internal (DB URLs, upstream errors, credentials in a
        // connection string) and must not reach the client in production.
        // 4xx messages are deliberate, client-facing context and are kept.
        // Without this the batch endpoint was a way around the sanitizer —
        // and it is the path the React client uses by default.
        entries.push({
          action,
          status,
          error:
            status >= 500 && this.alepha.isProduction()
              ? "Internal Server Error"
              : message,
        });
      }

      return entries;
    },
  });

  /**
   * Announces a sub-request failure on `server:onError`, the way the
   * single-request path does from `ServerRouterProvider.errorHandler`.
   *
   * ⚠️ **Not optional bookkeeping.** This endpoint answers 200 with a
   * per-entry error, so `errorHandler` — the only other emitter of that event
   * — never runs for anything that fails in here. Every consumer of the event
   * (the error logger, the log buffer, crash reporting) was therefore blind
   * to the batch, and the batch is the path the React client uses by default:
   * on a client-rendered app it is not some corner of the API surface, it is
   * the whole of it. An app can lose an entire outage this way and see an
   * empty crash inbox throughout.
   *
   * The route reported is the failing action's own, not `/api/_batch` —
   * reports that all blame the batch endpoint name the one route that is
   * always innocent, and group into one useless pile.
   *
   * **The batch's own reply is restored afterwards.** A hook may answer the
   * event by setting a status (that is how a custom error page works, and
   * `errorHandler` explicitly honours it). Here the response is already
   * decided: the failure belongs to one entry, and letting a hook promote it
   * would fail the whole batch — including the entries that succeeded.
   */
  protected async reportSubRequestError(
    request: any,
    action: string,
    error: unknown,
  ): Promise<void> {
    const reply = request.reply;
    const status = reply?.status;
    try {
      await this.alepha.events.emit("server:onError", {
        request,
        route: { path: this.actionPath(action) } as any,
        error: error as Error,
      });
    } catch (hookError) {
      // A broken observer must never turn a reported failure into a second
      // one, nor take down the entries that succeeded.
      this.log.warn("server:onError hook failed for a batch entry", hookError);
    } finally {
      if (reply) reply.status = status;
    }
  }

  /**
   * The path a direct HTTP call to `action` would have hit — prefix included,
   * the same composition {@link LinkProvider.followRemote} performs.
   *
   * Reported rather than the bare link path so one failing action reads
   * identically whether it failed inside a batch or as its own request.
   * Falls back to the action name when the link is unknown, which is a
   * poorer label but a truthful one.
   */
  protected actionPath(action: string): string {
    const link = this.linkProvider.links.find((it) => it.name === action);
    if (!link) return action;
    return `${link.prefix ?? "/api"}${link.path}`;
  }

  protected static readonly MAX_BATCH_SIZE = 20;

  /**
   * Cache key for the registry response.
   *
   * Every input {@link isLinkAccessible} reads must appear here, or one
   * identity's registry is served to another:
   *
   * - authentication itself — `$secure()` is auth-only, so an authenticated
   *   user carrying no roles sees strictly more than an anonymous visitor.
   *   Keying on roles alone made both `""`.
   * - the realm — `$secure({ issuers })` filters on it, so realm A and realm B
   *   with identical role names resolve to different link sets.
   */
  protected registryCacheKey(user?: UserAccountToken): string {
    if (!user) return "anonymous";
    const roles = user.roles?.slice().sort().join(",") ?? "";
    return `user:${user.realm ?? ""}:${roles}`;
  }

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

    const actions: Record<string, any> = {};
    const permissions: string[] = [];
    // Actions that exist but this caller may not invoke. Collected only for
    // authenticated callers — see `restricted` in apiRegistryResponseSchema.
    const restricted: string[] = [];

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
      if (!this.isLinkAccessible(link, user)) {
        if (user) restricted.push(link.name);
        continue;
      }

      actions[link.name] = {
        path: link.path,
        method: link.method || undefined,
        kind: link.kind,
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

      // Merge remote actions
      for (const [name, action] of Object.entries(registry.actions)) {
        let path = action.path.replace(remotePrefix, "");
        if (action.service) {
          path = `/${action.service}${path}`;
        }

        actions[name] = {
          path,
          method: action.method,
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

    return {
      prefix: this.serverApi.prefix,
      actions,
      permissions: permissions.length > 0 ? permissions : undefined,
      restricted: restricted.length > 0 ? restricted : undefined,
    };
  }

  /**
   * Check if a link is accessible by the given user based on security rules.
   */
  protected isLinkAccessible(
    link: HttpClientLink,
    user?: UserAccountToken,
  ): boolean {
    const { securityProvider } = this;

    if (securityProvider && link.secured) {
      if (!user) return false;

      if (typeof link.secured === "object") {
        // issuer check
        if (
          link.secured.issuers?.length &&
          (!user.realm || !link.secured.issuers.includes(user.realm))
        ) {
          return false;
        }

        // role check
        if (link.secured.roles?.length) {
          const hasRole = link.secured.roles.some((role: string) =>
            user.roles?.includes(role),
          );
          if (!hasRole) return false;
        }

        // explicit permission check
        if (link.secured.permissions?.length) {
          for (const perm of link.secured.permissions) {
            const result = securityProvider.checkPermission(
              perm,
              ...(user.roles ?? []),
            );
            if (!result.isAuthorized) return false;
          }
        }
      }
      // link.secured === true → auth only, user is already checked above
    }

    return true;
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
