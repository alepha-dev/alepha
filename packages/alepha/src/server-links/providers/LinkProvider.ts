import { $inject, Alepha, AlephaError, type Async, t } from "alepha";
import { $logger } from "alepha/logger";
import {
  type ActionDescriptor,
  type ClientRequestEntry,
  type ClientRequestOptions,
  type ClientRequestResponse,
  type FetchResponse,
  HttpClient,
  type RequestConfigSchema,
  ServerReply,
  type ServerRequest,
  type ServerRequestConfigEntry,
  type ServerResponseBody,
  UnauthorizedError,
} from "alepha/server";
import type { ServerRouteSecure } from "alepha/server/security";
import {
  type ApiLink,
  apiLinksResponseSchema,
} from "../schemas/apiLinksResponseSchema.ts";

/**
 * Browser, SSR friendly, service to handle links.
 */
export class LinkProvider {
  static path = {
    apiLinks: "/api/_links",
    apiSchema: "/api/_links/:name/schema",
  };

  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly httpClient = $inject(HttpClient);

  // all server links (local + remote)
  // THIS IS NOT USER LINKS! (which are filtered by permissions)
  protected serverLinks: Array<HttpClientLink> = [];

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

    return this.serverLinks;
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

    if (this.serverLinks.some((l) => l.name === link.name)) {
      // remove existing link with the same name
      this.serverLinks = this.serverLinks.filter((l) => l.name !== link.name);
    }

    this.serverLinks.push(link);
  }

  public get links(): HttpClientLink[] {
    // TODO: not performant at all, use a map instead for ServerLinks
    const apiLinks = this.alepha.state.get(
      "alepha.server.request.apiLinks",
    )?.links;
    if (apiLinks) {
      if (this.alepha.isBrowser()) {
        return apiLinks;
      }

      const links = [];
      for (const link of apiLinks) {
        const originalLink = this.serverLinks.find((l) => l.name === link.name);
        if (originalLink) {
          links.push(originalLink);
        }
      }
      return links;
    }

    return this.serverLinks ?? [];
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
          response: apiLinksResponseSchema,
        },
      },
    );

    this.alepha.state.set("alepha.server.request.apiLinks", data);

    return data.links;
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
   * Check if a link with the given name exists.
   * @param name
   */
  public can(name: string): boolean {
    return this.links.some((link) => link.name === name);
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

    const als = this.alepha.context.get<ServerRequest>("request");
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
      // we assume that typescript will check
      schema: {
        body: t.any(),
        response: t.any(),
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
      action: action as any, // schema.body TAny is not accepted
    });
  }

  protected async getLinkByName(
    name: string,
    options: ClientScope = {},
  ): Promise<HttpClientLink> {
    if (
      this.alepha.isBrowser() &&
      !this.alepha.state.get("alepha.server.request.apiLinks")
    ) {
      await this.fetchLinks();
    }

    const link = this.links.find(
      (a) =>
        a.name === name &&
        (!options.group || a.group === options.group) &&
        (!options.service || options.service === a.service),
    );

    if (!link) {
      const error = new UnauthorizedError(`Action ${name} not found.`);
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

export interface HttpClientLink extends ApiLink {
  secured?: boolean | ServerRouteSecure;
  prefix?: string;
  // -- server only --
  // only for remote actions
  host?: string;
  service?: string;
  // used only for local actions, not for remote actions
  schema?: RequestConfigSchema;
  handler?: (
    request: ServerRequest,
    options: ClientRequestOptions,
  ) => Async<ServerResponseBody>;
}

export interface ClientScope {
  group?: string;
  service?: string;
  hostname?: string;
}

export type HttpVirtualClient<T> = {
  [K in keyof T as T[K] extends ActionDescriptor<RequestConfigSchema>
    ? K
    : never]: T[K] extends ActionDescriptor<infer Schema>
    ? VirtualAction<Schema>
    : never;
};

export interface VirtualAction<T extends RequestConfigSchema>
  extends Pick<ActionDescriptor<T>, "name" | "run" | "fetch"> {
  (
    config?: ClientRequestEntry<T>,
    opts?: ClientRequestOptions,
  ): Promise<ClientRequestResponse<T>>;
  can: () => boolean;
}
