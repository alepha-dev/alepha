import { $inject, $store, Alepha, AlephaError, type Async, z } from "alepha";
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

  // Server-side: all registered links (local + remote), keyed by name
  protected serverLinkMap = new Map<string, HttpClientLink>();

  // Browser/SSR: parsed from the registry response
  protected actionMap = new Map<string, HttpClientLink>();
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
   * Force browser to refresh links from the server.
   */
  public async fetchLinks(): Promise<HttpClientLink[]> {
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

    $.run = async (config: any = {}, options: ClientRequestOptions = {}) => {
      return this.follow(name, config, {
        ...scope,
        ...options,
      });
    };

    $.fetch = async (config: any = {}, options: ClientRequestOptions = {}) => {
      const link = await this.getLinkByName(name, scope);
      return this.followRemote(link, config, options);
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

    if (options.hostname) {
      return {
        ...link,
        host: options.hostname,
      };
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

export type HttpVirtualClient<T> = {
  [K in keyof T as T[K] extends ActionPrimitive<RequestConfigSchema>
    ? K
    : never]: T[K] extends ActionPrimitive<infer Schema>
    ? VirtualAction<Schema>
    : never;
} & {
  [K in keyof T as T[K] extends SsePrimitive<SseConfigSchema>
    ? K
    : never]: T[K] extends SsePrimitive<infer Schema>
    ? VirtualSse<Schema>
    : never;
};

export interface VirtualAction<T extends RequestConfigSchema>
  extends Pick<ActionPrimitive<T>, "name" | "run" | "fetch"> {
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
