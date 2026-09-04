import { $hook, $inject, $store, Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import type { ServiceAccountPrimitive } from "alepha/security";
import { serverApiOptions } from "alepha/server";
import { ServerProxyProvider } from "alepha/server/proxy";

import { $remote, type RemotePrimitive } from "../primitives/$remote.ts";
import {
  type ApiRegistryResponse,
  apiRegistryResponseSchema,
} from "../schemas/apiLinksResponseSchema.ts";
import { LinkProvider } from "./LinkProvider.ts";

export class RemotePrimitiveProvider {
  protected readonly serverApi = $store(serverApiOptions);
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly proxyProvider = $inject(ServerProxyProvider);
  protected readonly linkProvider = $inject(LinkProvider);
  protected readonly remotes: Array<ServerRemote> = [];
  protected readonly log = $logger();

  public getRemotes(): ServerRemote[] {
    return this.remotes;
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
        const token =
          typeof remote.serviceAccount?.token === "function"
            ? await remote.serviceAccount.token()
            : undefined;

        if (!remote.internal) {
          continue; // skip download links for remotes that are not internal
        }

        const registry = await remote.links({ authorization: token });

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
      proxy: !!options.proxy,
      internal: !proxy.noInternal,
      links: async (opts) => {
        const { authorization } = opts;
        const remoteApi = await this.fetchLinks({
          service: name,
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

    if (options.proxy) {
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
      });
    }
  }

  /**
   * Fetch a remote's link registry, retrying transient failures.
   *
   * Ten attempts, exponential backoff from one second, capped at ten
   * seconds. This is the one place the framework retries in-process: jobs,
   * queues and workflows persist their attempts instead, which is why the
   * former `alepha/retry` module had no other caller.
   */
  protected async fetchLinks(
    opts: FetchLinksOptions,
  ): Promise<ApiRegistryResponse> {
    const attempts = 10;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.fetchLinksOnce(opts);
      } catch (error) {
        if (attempt >= attempts) {
          throw error;
        }
        this.log.warn(`Failed to fetch links, retry (${attempt})...`);
        await this.dateTime.wait(Math.min(1000 * 2 ** (attempt - 1), 10_000));
      }
    }
  }

  protected async fetchLinksOnce(
    opts: FetchLinksOptions,
  ): Promise<ApiRegistryResponse> {
    const { url, authorization } = opts;
    const response = await fetch(url, {
      headers: new Headers(authorization ? { authorization } : {}),
    });

    if (!response.ok) {
      throw new AlephaError(`Failed to fetch links from ${url}`);
    }

    return this.alepha.codec.decode(
      apiRegistryResponseSchema,
      await response.json(),
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export interface FetchLinksOptions {
  /**
   * Name of the remote service.
   */
  service: string;

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
   * It's only used inside the application.
   */
  internal: boolean;

  /**
   * Links fetcher.
   */
  links: (args: { authorization?: string }) => Promise<ApiRegistryResponse>;

  /**
   * Force a default access token provider when not provided.
   */
  serviceAccount?: ServiceAccountPrimitive;

  /**
   * Prefix for the remote service links.
   */
  prefix: string;
}
