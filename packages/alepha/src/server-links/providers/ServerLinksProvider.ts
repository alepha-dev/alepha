import { $env, $hook, $inject, Alepha, t } from "alepha";
import {
  type Permission,
  SecurityProvider,
  type UserAccountToken,
} from "alepha/security";
import {
  $action,
  $route,
  type ClientRequestEntry,
  type ClientRequestOptions,
  type RequestConfigSchema,
  ServerTimingProvider,
} from "alepha/server";
import {
  type ApiLink,
  type ApiLinksResponse,
  apiLinksResponseSchema,
} from "../schemas/apiLinksResponseSchema.ts";
import { LinkProvider } from "./LinkProvider.ts";
import { RemoteDescriptorProvider } from "./RemoteDescriptorProvider.ts";

const envSchema = t.object({
  SERVER_API_PREFIX: t.text({
    description: "Prefix for all API routes (e.g. $action).",
    default: "/api",
  }),
});

export class ServerLinksProvider {
  protected readonly env = $env(envSchema);
  protected readonly alepha = $inject(Alepha);
  protected readonly linkProvider = $inject(LinkProvider);
  protected readonly remoteProvider = $inject(RemoteDescriptorProvider);
  protected readonly serverTimingProvider = $inject(ServerTimingProvider);

  public get prefix() {
    return this.env.SERVER_API_PREFIX;
  }

  public readonly onRoute = $hook({
    on: "configure",
    handler: () => {
      // convert all $action to local links
      for (const action of this.alepha.descriptors($action)) {
        this.linkProvider.registerLink({
          name: action.name,
          group: action.group,
          schema: action.options.schema,
          requestBodyType: action.getBodyContentType(),
          secured: action.options.secure ?? true,
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

  /**
   * First API - Get all API links for the user.
   *
   * This is based on the user's permissions.
   */
  public readonly links = $route({
    path: LinkProvider.path.apiLinks,
    schema: {
      response: apiLinksResponseSchema,
    },
    handler: ({ user, headers }) => {
      return this.getUserApiLinks({
        user,
        authorization: headers.authorization,
      });
    },
  });

  /**
   * Second API - Get schema for a specific API link.
   *
   * Note: Body/Response schema are not included in `links` API because it's TOO BIG.
   * I mean for 150+ links, you got 50ms of serialization time.
   */
  public readonly schema = $route({
    path: LinkProvider.path.apiSchema,
    schema: {
      params: t.object({
        name: t.text(),
      }),
      response: t.json(),
    },
    handler: ({ params, user, headers }) => {
      return this.getSchemaByName(params.name, {
        user,
        authorization: headers.authorization,
      });
    },
  });

  public async getSchemaByName(
    name: string,
    options: GetApiLinksOptions = {},
  ): Promise<RequestConfigSchema> {
    const authorization = options.authorization;
    const api = await this.getUserApiLinks({
      user: options.user,
      authorization,
    });

    for (const link of api.links) {
      if (link.name === name) {
        if (link.service) {
          // remote
          return this.remoteProvider
            .getRemotes()
            .find((it) => it.name === link.service)
            ?.schema({ name: name, authorization });
        }

        // local
        return (
          this.linkProvider.getServerLinks().find((it) => it.name === name)
            ?.schema ?? {}
        );
      }
    }

    return {};
  }

  /**
   * Retrieves API links for the user based on their permissions.
   * Will check on local links and remote links.
   */
  public async getUserApiLinks(
    options: GetApiLinksOptions,
  ): Promise<ApiLinksResponse> {
    const { user } = options;
    let permissions: Permission[] | undefined;
    let permissionMap: Map<string, Permission> | undefined;
    const hasSecurity = this.alepha.has(SecurityProvider);
    if (hasSecurity && user) {
      permissions = this.alepha.inject(SecurityProvider).getPermissions(user);
      permissionMap = new Map(
        permissions.map((it) => [`${it.group}:${it.name}`, it]),
      );
    }

    const userLinks: ApiLink[] = [];

    // bonus: add permissions not related to $action
    for (const permission of permissions ?? []) {
      if (
        !permission.path &&
        !permission.method &&
        permission.name &&
        permission.group
      ) {
        userLinks.push({
          path: "", // this is a placeholder for links without specific path
          name: permission.name,
          group: permission.group,
        });
      }
    }

    // add local links
    for (const link of this.linkProvider.getServerLinks()) {
      // SKIP REMOTE LINKS, remote links are handled separately for security
      if (link.host) continue;

      if (hasSecurity && link.secured) {
        // skip secured links if user is not provided
        if (!user) {
          continue;
        }

        if (typeof link.secured === "object" && link.secured.realm) {
          // realm check
          if (user.realm !== link.secured.realm) {
            continue;
          }
        } else if (permissionMap) {
          // small permissions check, can be optimized later ... :')

          if (!permissionMap.has(`${link.group}:${link.name}`)) {
            continue;
          }
        }
      }

      userLinks.push({
        name: link.name,
        group: link.group,
        requestBodyType: link.requestBodyType,
        method: link.method,
        path: link.path,
      });
    }

    this.serverTimingProvider.beginTiming("fetchRemoteLinks");
    // this does not scale well, but it's working for now
    // TODO: remote links can be cached by user.roles
    const promises = this.remoteProvider
      .getRemotes()
      .filter((it) => it.proxy) // add only "proxy" remotes
      .map(async (remote) => {
        const { links, prefix } = await remote.links(options);
        return links.map((link) => {
          let path = link.path.replace(prefix ?? "/api", "");
          if (link.service) {
            path = `/${link.service}${path}`;
          }

          return {
            ...link,
            path,
            proxy: true,
            service: remote.name,
          };
        });
      });

    userLinks.push(...(await Promise.all(promises)).flat());
    this.serverTimingProvider.endTiming("fetchRemoteLinks");

    return {
      prefix: this.env.SERVER_API_PREFIX,
      links: userLinks,
    };
  }
}

export interface GetApiLinksOptions {
  user?: UserAccountToken;
  authorization?: string;
}
