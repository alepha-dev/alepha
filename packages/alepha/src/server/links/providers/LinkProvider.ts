import { $inject, $store, Alepha, AlephaError, type Async, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import type { SecureOptions } from "alepha/security";
import {
  type ActionPrimitive,
  type ClientRequestEntry,
  type ClientRequestOptions,
  type ClientRequestResponse,
  type FetchResponse,
  ForbiddenError,
  HttpClient,
  type RequestConfigSchema,
  ServerReply,
  type ServerRequest,
  type ServerRequestConfigEntry,
  type ServerResponseBody,
  type SseConfigSchema,
  type SseEventData,
  type SsePrimitive,
  type SseRequestEntry,
  type SseStream,
  UnauthorizedError,
} from "alepha/server";

import { linkOptionsAtom } from "../atoms/linkOptionsAtom.ts";
import {
  type ApiRegistryResponse,
  apiRegistryResponseSchema,
} from "../schemas/apiLinksResponseSchema.ts";
import { BatchCollector } from "../services/BatchCollector.ts";

/**
 * Browser, SSR friendly, service to handle links.
 */
export class LinkProvider {
  static path = {
    apiLinks: "/api/_links",
  };

  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly httpClient = $inject(HttpClient);
  protected readonly dateTime = $inject(DateTimeProvider);

  // Server-side: all registered links (local + remote), keyed by name
  protected serverLinkMap = new Map<string, HttpClientLink>();

  // Browser/SSR: parsed from the registry response
  protected actionMap = new Map<string, HttpClientLink>();

  /**
   * One parsed registry per remote, keyed by {@link registryKey}.
   *
   * ⚠️ A remote registry cannot share the two stores above, and that is the
   * whole reason this exists. Writing it into `alepha.server.request.apiLinks`
   * resolves to nothing outside a browser: the non-browser branch of
   * {@link links} maps registry names back onto `serverLinkMap` and keeps only
   * what it finds there, and in a CLI `serverLinkMap` is empty. Everything
   * would look wired up and nothing would resolve.
   *
   * Keyed rather than a single slot so a process talking to two Alepha apps
   * does not have one evict the other.
   */
  protected remoteLinks = new Map<string, RemoteRegistry>();
  protected permissions = new Set<string>();
  /**
   * Action names the server reported as existing but not callable by this
   * caller (see `restricted` in apiRegistryResponseSchema). Populated only
   * for authenticated callers.
   */
  protected restricted = new Set<string>();
  protected lastLoadedRegistry: ApiRegistryResponse | null = null;

  // Browser-only: batch collector for coalescing multiple calls
  protected batchCollector?: BatchCollector;

  protected readonly options = $store(linkOptionsAtom);

  /**
   * Get applicative links registered on the server.
   * This does not include lazy-loaded remote links.
   */
  public getServerLinks(): HttpClientLink[] {
    if (this.alepha.isBrowser()) {
      this.log.warn(
        "Getting server links in the browser is not supported. Use `fetchLinks` to get links from the server.",
      );
      return [];
    }

    return [...this.serverLinkMap.values()];
  }

  /**
   * Register a new link for the application.
   */
  public registerLink(link: HttpClientLink): void {
    if (this.alepha.isBrowser()) {
      this.log.warn(
        "Registering links in the browser is not supported. Use `fetchLinks` to get links from the server.",
      );
      return;
    }

    if (!link.handler && !link.host) {
      throw new AlephaError(
        "Can't create link - 'handler' or 'host' is required",
      );
    }

    // Detect duplicate local actions (programming error)
    const existing = this.serverLinkMap.get(link.name);
    if (existing?.handler && link.handler) {
      throw new AlephaError(
        `Duplicate action name "${link.name}". Each action must have a unique name.`,
      );
    }

    this.serverLinkMap.set(link.name, link);
  }

  /**
   * Load the registry response into internal stores (actionMap, permissions, definitions).
   * Called when storing from atom/fetch/SSR.
   */
  protected loadRegistry(registry: ApiRegistryResponse): void {
    this.lastLoadedRegistry = registry;
    this.permissions.clear();
    this.actionMap.clear();
    this.restricted.clear();

    for (const [name, action] of Object.entries(registry.actions)) {
      this.actionMap.set(name, {
        name,
        path: action.path,
        kind: action.kind,
        method: action.method,
        contentType: action.contentType,
        service: action.service,
        // The registry states the prefix its paths are relative to, and
        // `followRemote` falls back to "/api" without it — so dropping it here
        // silently addressed every registry-derived link as if the server ran
        // on the default. Left undefined when the registry omits it, which is
        // the same fallback as before.
        prefix: registry.prefix,
      });
    }

    if (registry.permissions) {
      for (const p of registry.permissions) {
        this.permissions.add(p);
      }
    }

    if (registry.restricted) {
      for (const name of registry.restricted) {
        this.restricted.add(name);
      }
    }
  }

  public get links(): HttpClientLink[] {
    const registry = this.alepha.store.get("alepha.server.request.apiLinks");

    if (registry) {
      if (this.alepha.isBrowser()) {
        // Browser side: use the parsed action map
        // Reload when registry changes (e.g. after login provides new authenticated links)
        if (this.actionMap.size === 0 || registry !== this.lastLoadedRegistry) {
          this.loadRegistry(registry);
        }
        return [...this.actionMap.values()];
      }

      // SSR side: map registry actions back to full server links
      const links: HttpClientLink[] = [];
      for (const name of Object.keys(registry.actions)) {
        const originalLink = this.serverLinkMap.get(name);
        if (originalLink) {
          links.push(originalLink);
        }
      }
      return links;
    }

    return [...this.serverLinkMap.values()];
  }

  /**
   * Force a refresh of the registry.
   *
   * With a `hostname` on the scope this targets that remote and parses into
   * {@link remoteLinks}. Without one it is what it has always been: the
   * browser's own registry, written to the store slot SSR hydrates from.
   *
   * The two must not converge. The local path owns the store slot, the ETag
   * cache, `permissions` and `restricted`; a remote fetch that touched any of
   * them would overwrite the caller's own registry with someone else's.
   */
  public async fetchLinks(scope: ClientScope = {}): Promise<HttpClientLink[]> {
    if (scope.hostname) {
      const host = this.normalizeHost(scope.hostname);
      const registry = await this.fetchRemoteRegistry(
        host,
        this.registryKey(host, scope),
      );
      return [...registry.links.values()];
    }

    const { data } = await this.httpClient.fetch(
      `${LinkProvider.path.apiLinks}`,
      {
        method: "GET",
        schema: {
          response: apiRegistryResponseSchema,
        },
      },
    );

    this.alepha.store.set("alepha.server.request.apiLinks", data);
    this.loadRegistry(data);

    return [...this.actionMap.values()];
  }

  /**
   * The remote's registry, fetched on first use and held until it goes stale.
   *
   * Staleness is a TTL rather than a refetch per call because `/api/_links`
   * emits an ETag and {@link HttpClient} revalidates with `if-none-match`, so
   * an expired entry costs a 304 rather than a payload.
   */
  protected async remoteRegistry(scope: ClientScope): Promise<RemoteRegistry> {
    const host = this.normalizeHost(scope.hostname as string);
    const key = this.registryKey(host, scope);
    const cached = this.remoteLinks.get(key);

    if (
      cached &&
      this.dateTime.nowMillis() - cached.fetchedAt <
        this.options.remoteRegistryTtl * 1000
    ) {
      return cached;
    }

    return await this.fetchRemoteRegistry(host, key);
  }

  /**
   * What identifies one cached registry.
   *
   * The host alone today, because nothing yet authenticates the fetch. It has
   * to stay a seam: `/api/_links` filters its answer by caller, so once a
   * credential is on the scope a host-only key would serve one caller's action
   * set to another.
   */
  protected registryKey(host: string, _scope: ClientScope): string {
    return host;
  }

  /**
   * An origin, or a refusal.
   *
   * A hostname carrying a path is rejected rather than quietly trimmed: a
   * caller who wrote `https://api.example.com/v1` means those requests to go
   * under `/v1`, and the registry's own `prefix` is what actually decides that.
   * Trimming would silently send them somewhere else.
   */
  protected normalizeHost(hostname: string): string {
    let url: URL;
    try {
      url = new URL(hostname);
    } catch {
      throw new AlephaError(
        `Invalid hostname "${hostname}" - an absolute URL is required, e.g. "https://api.example.com".`,
      );
    }

    if (url.pathname !== "/" || url.search || url.hash) {
      throw new AlephaError(
        `Invalid hostname "${hostname}" - expected an origin with no path, query or fragment. The remote's own api prefix comes from its registry.`,
      );
    }

    return url.origin;
  }

  protected async fetchRemoteRegistry(
    host: string,
    key: string,
  ): Promise<RemoteRegistry> {
    let data: ApiRegistryResponse;

    try {
      ({ data } = await this.httpClient.fetch(
        `${host}${LinkProvider.path.apiLinks}`,
        {
          method: "GET",
          schema: {
            response: apiRegistryResponseSchema,
          },
        },
      ));
    } catch (cause) {
      // Named, and not swallowed. A process may hold several remotes, so a
      // bare fetch failure says nothing about which one is down — and falling
      // back to an empty registry would turn a reachability problem into
      // `Action not found` on every call, which reads as a permission or
      // routing bug and sends the reader looking in the wrong place.
      throw new AlephaError(
        `Could not fetch the action registry of ${host}${LinkProvider.path.apiLinks}.`,
        { cause },
      );
    }

    const registry: RemoteRegistry = {
      links: new Map(),
      restricted: new Set(data.restricted ?? []),
      fetchedAt: this.dateTime.nowMillis(),
    };

    for (const [name, action] of Object.entries(data.actions)) {
      registry.links.set(name, {
        name,
        // Composed once, here, rather than at every call. `followRemote` only
        // prepends the service for a hostless link (the browser's case), so a
        // remote's proxied action would otherwise lose the segment that
        // addresses it on that remote.
        path: action.service ? `/${action.service}${action.path}` : action.path,
        kind: action.kind,
        method: action.method,
        contentType: action.contentType,
        service: action.service,
        prefix: data.prefix,
        host,
      });
    }

    this.remoteLinks.set(key, registry);

    return registry;
  }

  /**
   * Create a virtual client that can be used to call actions.
   *
   * Use js Proxy under the hood.
   */
  public client<T extends object>(
    scope: ClientScope = {},
  ): HttpVirtualClient<T> {
    return new Proxy<HttpVirtualClient<T>>({} as HttpVirtualClient<T>, {
      get: (_, prop) => {
        if (typeof prop !== "string") {
          return;
        }

        return this.createVirtualAction<RequestConfigSchema>(prop, scope);
      },
    });
  }

  /**
   * Check if a link with the given name exists or a permission matches.
   *
   * Action names never contain colons. Permission names always do.
   * - `can("getUsers")` → O(1) map lookup
   * - `can("admin:*")` → wildcard match against permissions set
   * - `can("admin:user:read")` → O(1) set lookup
   */
  public can(name: string): boolean {
    // Ensure the registry parsed from the store (actions + permissions) is
    // loaded. On SSR the `links` getter only calls `loadRegistry` in the
    // browser branch, so `this.permissions` would otherwise stay empty and
    // every permission check would (wrongly) fail — making `has()`-gated UI
    // render differently on the server than on the client (hydration drift).
    const registry = this.alepha.store.get("alepha.server.request.apiLinks");
    if (registry && registry !== this.lastLoadedRegistry) {
      this.loadRegistry(registry);
    }

    // Action check — O(1) map lookup
    if (this.actionMap.size > 0) {
      if (this.actionMap.has(name)) return true;
    } else {
      // Fallback for server-side where actionMap may not be populated
      if (this.serverLinkMap.has(name)) return true;
      // Also check links getter (for SSR with atom)
      if (this.links.some((link) => link.name === name)) return true;
    }

    // Permission check — wildcard matching
    if (name.includes(":")) {
      if (name.endsWith("*")) {
        const prefix = name.slice(0, -1);
        for (const p of this.permissions) {
          if (p.startsWith(prefix)) return true;
        }
        return false;
      }
      return this.permissions.has(name);
    }

    return false;
  }

  /**
   * Resolve a link by its name and call it.
   * - If link is local, it will call the local handler.
   * - If link is remote, it will make a fetch request to the remote server.
   */
  public async follow(
    name: string,
    config: Partial<ServerRequestConfigEntry> = {},
    options: ClientRequestOptions & ClientScope = {},
  ): Promise<any> {
    this.log.trace("Following link", { name, config, options });
    const link = await this.getLinkByName(name, options);

    // if a handler is defined, use it (ssr)
    if (link.handler && !options.request) {
      this.log.trace("Local link found", { name });
      return link.handler(
        {
          method: link.method,
          url: new URL(`http://localhost${link.path}`),
          query: config.query ?? {},
          body: config.body ?? {},
          params: config.params ?? {},
          headers: config.headers ?? {},
          metadata: {},
          reply: new ServerReply(),
        } as Partial<ServerRequest> as ServerRequest,
        options,
      );
    }

    this.log.trace("Remote link found", {
      name,
      host: link.host,
      service: link.service,
    });

    // Browser-only: use batch collector for calls without explicit host
    if (this.options.batch && this.alepha.isBrowser() && !link.host) {
      this.batchCollector ??= this.alepha.inject(BatchCollector);
      return this.batchCollector.add({
        action: name,
        params: config.params as any,
        query: config.query as any,
        body: config.body as any,
        directCall: () =>
          this.followRemote(link, config, options).then((r) => r.data),
      });
    }

    return this.followRemote(link, config, options).then(
      (response) => response.data,
    );
  }

  protected createVirtualAction<T extends RequestConfigSchema>(
    name: string,
    scope: ClientScope = {},
  ): VirtualAction<T> {
    const $: VirtualAction<T> = async (
      config: any = {},
      options: ClientRequestOptions = {},
    ) => {
      return this.follow(name, config, {
        ...scope,
        ...options,
      });
    };

    Object.defineProperty($, "name", {
      value: name,
      writable: false,
    });

    $.run = async (config: any = {}, options: ClientRequestOptions) => {
      return this.follow(name, config, {
        ...scope,
        ...options,
      });
    };

    $.fetch = async (config: any = {}, options: ClientRequestOptions = {}) => {
      const link = await this.getLinkByName(name, scope);
      // Merged the way `$` and `$.run` merge it. This used the scope to
      // resolve the link and then dropped it for the request itself, so the
      // hostname survived (it is baked into the link) and nothing else did.
      return this.followRemote(link, config, { ...scope, ...options });
    };

    $.can = () => {
      return this.can(name);
    };

    return $;
  }

  protected async followRemote(
    link: HttpClientLink,
    config: Partial<ServerRequestConfigEntry> = {},
    options: ClientRequestOptions = {},
  ): Promise<FetchResponse> {
    options.request ??= {};
    options.request.headers = new Headers(options.request.headers);

    const als = this.alepha.store.get("alepha.http.request");
    if (als?.headers.authorization) {
      options.request.headers.set("authorization", als.headers.authorization);
    }

    const context = this.alepha.context.get("context");
    if (typeof context === "string") {
      options.request.headers.set("x-request-id", context);
    }

    const action = {
      ...link,
      // schema is not used in the client,
      // we assume that TypeScript will check
      schema: {
        body: z.any(),
        response: z.any(),
      },
    };

    // prefix with service when host is not defined (e.g. browser)
    if (!link.host && link.service) {
      action.path = `/${link.service}${action.path}`;
    }

    action.path = `${action.prefix ?? "/api"}${action.path}`;
    action.prefix = undefined; // prefix is not used in the client

    // else, make a request
    return this.httpClient.fetchAction({
      host: link.host,
      config,
      options,
      action: action as any, // schema.body ZodAny is not accepted
    });
  }

  protected async getLinkByName(
    name: string,
    options: ClientScope = {},
  ): Promise<HttpClientLink> {
    // First, and self-contained: a named host resolves against that host's own
    // registry and nothing else. Everything below is the local/browser/SSR
    // path, unchanged. The `isBrowser()` gate on the auto-fetch is dropped for
    // this branch alone, which is what lets a CLI, a worker or a script
    // resolve at all.
    if (options.hostname) {
      return await this.getRemoteLinkByName(name, options);
    }

    if (
      this.alepha.isBrowser() &&
      !this.alepha.store.get("alepha.server.request.apiLinks")
    ) {
      await this.fetchLinks();
    }

    const link = this.links.find(
      (a) =>
        a.name === name && (!options.service || options.service === a.service),
    );

    // Same reason `can()` does this: the `links` getter only calls
    // loadRegistry on the browser branch, so during SSR `restricted` would
    // otherwise stay empty and a forbidden action would report 401 on the
    // server and 403 in the browser — the page would redirect to login on
    // first paint and only then render the refusal.
    const registry = this.alepha.store.get("alepha.server.request.apiLinks");
    if (registry && registry !== this.lastLoadedRegistry) {
      this.loadRegistry(registry);
    }

    if (!link) {
      // An action the server knows about but pruned for this caller is a
      // permission problem, not a missing route. Saying 401 here sends a
      // signed-in user to the login page for what is really a refusal —
      // and leaves the app unable to tell the two apart without matching
      // on the message text. `restricted` is only populated for
      // authenticated callers, so anonymous requests still get 401 and
      // still redirect to login.
      const error = this.restricted.has(name)
        ? new ForbiddenError(`Action ${name} is not allowed for this user.`)
        : new UnauthorizedError(`Action ${name} not found.`);
      // mimic http error handling
      await this.alepha.events.emit("client:onError", {
        route: link,
        error,
      });
      throw error;
    }

    // A `hostname` never reaches here any more: it is answered by the remote
    // branch above, against the remote's own registry. Stamping the host onto
    // a LOCAL link was the weaker mechanism this replaces — it borrowed this
    // container's paths, prefix and permission view and pointed them at
    // someone else's server.
    return link;
  }

  protected async getRemoteLinkByName(
    name: string,
    scope: ClientScope,
  ): Promise<HttpClientLink> {
    const registry = await this.remoteRegistry(scope);
    const link = registry.links.get(name);

    if (!link) {
      // The same distinction the local path draws, drawn from the remote's own
      // answer: `restricted` is what that server said exists but is not yours
      // to call, and it is only populated for authenticated callers.
      const error = registry.restricted.has(name)
        ? new ForbiddenError(`Action ${name} is not allowed for this user.`)
        : new UnauthorizedError(`Action ${name} not found.`);
      await this.alepha.events.emit("client:onError", {
        route: link,
        error,
      });
      throw error;
    }

    return link;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export interface HttpClientLink {
  name: string;
  path: string;
  method?: string;
  kind?: string;
  contentType?: string;
  service?: string;
  secured?: boolean | SecureOptions;
  prefix?: string;
  group?: string;
  // -- server only --
  host?: string;
  schema?: RequestConfigSchema;
  handler?: (
    request: ServerRequest,
    options: ClientRequestOptions,
  ) => Async<ServerResponseBody>;
}

export interface ClientScope {
  service?: string;
  hostname?: string;
}

/**
 * One remote Alepha app's action registry, as this client holds it.
 */
export interface RemoteRegistry {
  /**
   * The remote's callable actions, with its host and prefix already stamped
   * so nothing has to be recomposed at call time.
   */
  links: Map<string, HttpClientLink>;

  /**
   * What the remote said exists but is not callable by this caller. Empty for
   * an anonymous fetch, by design: see `restricted` in
   * `apiRegistryResponseSchema`.
   */
  restricted: Set<string>;

  fetchedAt: number;
}

export type HttpVirtualClient<T> = {
  [
    K in keyof T as T[K] extends ActionPrimitive<RequestConfigSchema>
      ? K
      : never
  ]: T[K] extends ActionPrimitive<infer Schema> ? VirtualAction<Schema> : never;
} & {
  [
    K in keyof T as T[K] extends SsePrimitive<SseConfigSchema> ? K : never
  ]: T[K] extends SsePrimitive<infer Schema> ? VirtualSse<Schema> : never;
};

export interface VirtualAction<T extends RequestConfigSchema> extends Pick<
  ActionPrimitive<T>,
  "name" | "run" | "fetch"
> {
  (
    config?: ClientRequestEntry<T>,
    opts?: ClientRequestOptions,
  ): Promise<ClientRequestResponse<T>>;
  can: () => boolean;
}

export interface VirtualSse<T extends SseConfigSchema> {
  (config?: SseRequestEntry<T>): Promise<SseStream<SseEventData<T>>>;
  name: string;
  can: () => boolean;
}
