import { $hook, $inject, $pipeline, $store, Alepha, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { $retry } from "alepha/retry";
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
        const remoteApi = await this.fetchLinks.run({
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

  protected readonly fetchLinks = $pipeline({
    use: [
      $retry({
        max: 10,
        backoff: {
          initial: 1000,
        },
        onError: (_: Error, attempt: number) => {
          this.log.warn(`Failed to fetch links, retry (${attempt})...`);
        },
      }),
    ],
    handler: async (opts: FetchLinksOptions): Promise<ApiRegistryResponse> => {
      const { url, authorization } = opts;
      const response = await fetch(url, {
        headers: new Headers(
          authorization
            ? {
                authorization,
              }
            : {},
        ),
      });

      if (!response.ok) {
        throw new AlephaError(`Failed to fetch links from ${url}`);
      }

      return this.alepha.codec.decode(
        apiRegistryResponseSchema,
        await response.json(),
      );
    },
  });
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
