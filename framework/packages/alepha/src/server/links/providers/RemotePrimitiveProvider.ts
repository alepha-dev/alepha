import { $hook, $inject, $store, Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import type { ServiceAccountPrimitive } from "alepha/security";
import { HttpClient, serverApiOptions } from "alepha/server";
import {
  type ProxyForwardedCredential,
  ServerProxyProvider,
} from "alepha/server/proxy";

import { $remote, type RemotePrimitive } from "../primitives/$remote.ts";
import {
  type ApiRegistryResponse,
  apiRegistryResponseSchema,
} from "../schemas/apiLinksResponseSchema.ts";
import { type HttpClientLink, LinkProvider } from "./LinkProvider.ts";

export class RemotePrimitiveProvider {
  protected readonly serverApi = $store(serverApiOptions);
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly proxyProvider = $inject(ServerProxyProvider);
  protected readonly linkProvider = $inject(LinkProvider);
  protected readonly httpClient = $inject(HttpClient);
  protected readonly remotes: Array<ServerRemote> = [];
  protected readonly log = $logger();

  public getRemotes(): ServerRemote[] {
    return this.remotes;
  }

  /**
   * The remotes this server publishes: those declared with `proxy`, whose
   * actions a caller of this server may reach.
   *
   * This is the one rule behind everything a caller can see or call of a
   * remote: the proxy route exists for these remotes only, the registry
   * (`/api/_links`) lists the actions of these remotes only, and the batch
   * route (`/api/_batch`) follows a remote action only through
   * {@link publishedRemote}. A remote declared without `proxy` is for this
   * server's own code.
   */
  public getPublishedRemotes(): ServerRemote[] {
    return this.remotes.filter((it) => it.proxy);
  }

  /**
   * The published remote a link belongs to, or nothing when the link is
   * local or its remote is not published.
   */
  public publishedRemote(link: HttpClientLink): ServerRemote | undefined {
    if (!link.host) {
      return undefined;
    }
    return this.getPublishedRemotes().find(
      (it) => it.name === link.service && it.url === link.host,
    );
  }

  /**
   * The caller's credentials a published remote receives: of `authorization`
   * and `cookie`, those its `forward` names, by the same rule as its proxy
   * route.
   */
  public forwardedCredentials(
    remote: ServerRemote,
    headers: Record<string, unknown>,
  ): Record<string, string> {
    const credentials: Record<string, unknown> = {};
    for (const name of ["authorization", "cookie"]) {
      if (typeof headers[name] === "string") {
        credentials[name] = headers[name];
      }
    }
    return this.proxyProvider.forwardedHeaders(credentials, remote.forward);
  }

  public readonly configure = $hook({
    on: "configure",
    handler: async () => {
      const remotes = this.alepha.primitives($remote);
      for (const remote of remotes) {
        await this.registerRemote(remote);
      }
    },
  });

  public readonly start = $hook({
    on: "start",
    handler: async () => {
      for (const remote of this.remotes) {
        if (!remote.internal) {
          continue; // skip download links for remotes that are not internal
        }

        const registry = await remote.links({
          authorization: remote.serviceAccount
            ? await this.linkProvider.serviceAuthorization(
                remote.serviceAccount,
              )
            : undefined,
        });

        for (const [name, action] of Object.entries(registry.actions)) {
          let path = action.path.replace(remote.prefix, "");
          if (action.service) {
            path = `/${action.service}${path}`;
          }

          this.linkProvider.registerLink({
            name,
            path,
            method: action.method ?? undefined,
            contentType: action.contentType,
            prefix: remote.prefix,
            host: remote.url,
            service: remote.name,
            serviceAccount: remote.serviceAccount,
          });
        }

        this.log.info(`Remote '${remote.name}' OK`, {
          actions: Object.keys(registry.actions).length,
          prefix: remote.prefix,
        });
      }
    },
  });

  public async registerRemote(value: RemotePrimitive): Promise<void> {
    const options = value.options;
    const url = typeof options.url === "string" ? options.url : options.url();
    const linkPath = LinkProvider.path.apiLinks;
    const name = value.name;
    const proxy = typeof options.proxy === "object" ? options.proxy : {};

    const remote: ServerRemote = {
      url,
      name,
      prefix: "/api",
      serviceAccount: options.serviceAccount,
      // A disabled proxy has no route, so its remote is not published.
      proxy: !!options.proxy && !proxy.disabled,
      // The remote authenticates the caller, so its bearer travels (the
      // `$proxy` default sends none). `proxy: { forward }` overrides it.
      forward: proxy.forward ?? ["authorization"],
      internal: !proxy.noInternal,
      links: async (opts) => {
        const { authorization } = opts;
        const remoteApi = await this.fetchLinks({
          url: `${url}${linkPath}`,
          authorization,
        });

        if (remoteApi.prefix != null) {
          remote.prefix = remoteApi.prefix; // monkey patch the prefix, not ideal but works
        }

        return remoteApi;
      },
    };

    this.remotes.push(remote);

    if (remote.proxy) {
      this.proxyProvider.createProxy({
        path: `${this.serverApi.prefix}/${name}/*`,
        target: url,
        rewrite: (url) => {
          url.pathname = url.pathname.replace(
            `${this.serverApi.prefix}/${name}`,
            remote.prefix,
          );
        },
        ...proxy,
        // After the spread: the route and the batch read the one list, also
        // when `proxy` spells `forward: undefined`.
        forward: [...remote.forward],
      });
    }
  }

  /**
   * Fetch a remote's link registry, retrying transient failures.
   *
   * Ten attempts, exponential backoff from one second, capped at ten
   * seconds. This is the one place the framework retries in-process: jobs
   * and queues persist their attempts instead, which is why the former
   * `alepha/retry` module had no other caller.
   *
   * Detached from the caller's signal: the registry is read for a whole
   * identity and cached, so a caller who leaves during the read does not
   * abort it. An abort (the app stopping) is never retried.
   */
  protected fetchLinks(opts: FetchLinksOptions): Promise<ApiRegistryResponse> {
    return this.alepha.context.detachSignal(async () => {
      const attempts = 10;
      for (let attempt = 1; ; attempt++) {
        try {
          return await this.fetchLinksOnce(opts);
        } catch (error) {
          if (attempt >= attempts || this.alepha.context.isAbortError(error)) {
            throw error;
          }
          this.log.warn(`Failed to fetch links, retry (${attempt})...`);
          await this.dateTime.wait(Math.min(1000 * 2 ** (attempt - 1), 10_000));
        }
      }
    });
  }

  protected async fetchLinksOnce(
    opts: FetchLinksOptions,
  ): Promise<ApiRegistryResponse> {
    const { url, authorization } = opts;
    try {
      const { data } = await this.httpClient.fetch(url, {
        method: "GET",
        headers: new Headers(authorization ? { authorization } : {}),
        schema: { response: apiRegistryResponseSchema },
      });
      return data;
    } catch (cause) {
      throw new AlephaError(`Failed to fetch links from ${url}`, { cause });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export interface FetchLinksOptions {
  /**
   * URL to fetch links from.
   */
  url: string;

  /**
   * Authorization header containing access token.
   */
  authorization?: string;
}

export interface ServerRemote {
  /**
   * URL of the remote service.
   */
  url: string;

  /**
   * Name of the remote service.
   */
  name: string;

  /**
   * Expose links as endpoint. It's not only internal.
   */
  proxy: boolean;

  /**
   * The caller's credentials a call through this server carries to the
   * remote, by the proxy route and by the batch route alike.
   */
  forward: readonly ProxyForwardedCredential[];

  /**
   * It's only used inside the application.
   */
  internal: boolean;

  /**
   * Links fetcher.
   */
  links: (args: { authorization?: string }) => Promise<ApiRegistryResponse>;

  /**
   * The credential of a call this server's own code makes to the remote
   * when the call carries no authorization of its own.
   */
  serviceAccount?: ServiceAccountPrimitive;

  /**
   * Prefix for the remote service links.
   */
  prefix: string;
}
