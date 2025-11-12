import { $atom, $hook, $inject, $use, type Static, t } from "@alepha/core";
import { ServerRouterProvider } from "@alepha/server";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * CORS configuration atom
 */
export const corsOptions = $atom({
  name: "alepha.server.cors.options",
  schema: t.object({
    origin: t.optional(
      t.string({
        description:
          "Allowed origins (* for all, string for single, array for multiple)",
        default: "*",
      }),
    ),
    methods: t.array(t.string(), {
      description: "Allowed HTTP methods",
      default: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
    headers: t.array(t.string(), {
      description: "Allowed headers",
      default: ["Content-Type", "Authorization"],
    }),
    credentials: t.optional(
      t.boolean({
        description: "Allow credentials",
        default: true,
      }),
    ),
    maxAge: t.optional(
      t.number({
        description: "Preflight cache duration in seconds",
      }),
    ),
  }),
  default: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    headers: ["Content-Type", "Authorization"],
    credentials: true,
  },
});

export type CorsOptions = Static<typeof corsOptions.schema>;

declare module "@alepha/core" {
  interface State {
    [corsOptions.key]: CorsOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class ServerCorsProvider {
  protected readonly serverRouterProvider = $inject(ServerRouterProvider);
  protected readonly options = $use(corsOptions);

  protected readonly configure = $hook({
    on: "configure",
    handler: () => {
      const routes = this.serverRouterProvider.getRoutes();
      for (const route of routes) {
        if (
          !route.method ||
          route.method === "GET" ||
          route.method === "OPTIONS"
        ) {
          continue;
        }

        this.serverRouterProvider.createRoute({
          path: route.path,
          method: "OPTIONS",
          handler: ({ reply }) => {
            reply.setStatus(204);
          },
        });
      }
    },
  });

  protected readonly onRequest = $hook({
    on: "server:onRequest",
    handler: ({ request }) => {
      const reqOrigin = request.headers.origin;
      const { origin, methods, headers, credentials, maxAge } = this.options;

      if (reqOrigin && this.isOriginAllowed(reqOrigin, origin)) {
        request.reply.setHeader("Access-Control-Allow-Origin", reqOrigin);
      }

      if (credentials) {
        request.reply.setHeader("Access-Control-Allow-Credentials", "true");
      }

      request.reply.setHeader(
        "Access-Control-Allow-Methods",
        methods.join(", "),
      );
      request.reply.setHeader(
        "Access-Control-Allow-Headers",
        headers.join(", "),
      );

      if (maxAge != null) {
        request.reply.setHeader("Access-Control-Max-Age", String(maxAge));
      }
    },
  });

  public isOriginAllowed(
    origin: string | undefined,
    allowed: ServerCorsProviderOptions["origin"],
  ): boolean {
    if (!allowed) return false;
    if (allowed === "*") return true;
    return allowed
      .split(",")
      .map((o) => o.trim())
      .includes(origin ?? "");
  }
}

export type ServerCorsProviderOptions = CorsOptions;
