import { $atom, $hook, $inject, $use, type Static, t } from "alepha";
import { $logger } from "alepha/logger";
import { ServerRouterProvider } from "alepha/server";
import type { CorsPrimitiveConfig } from "../primitives/$cors.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * CORS configuration atom (global defaults)
 */
export const corsOptions = $atom({
  name: "alepha.server.cors.options",
  schema: t.object({
    origin: t.optional(
      t.string({
        description:
          "Allowed origins (* for all, string for single, comma-separated for multiple)",
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

declare module "alepha" {
  interface State {
    [corsOptions.key]: CorsOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class ServerCorsProvider {
  protected readonly log = $logger();
  protected readonly serverRouterProvider = $inject(ServerRouterProvider);
  protected readonly globalOptions = $use(corsOptions);

  /**
   * Registered CORS configurations with their path patterns
   */
  public readonly registeredConfigs: CorsPrimitiveConfig[] = [];

  /**
   * Register a CORS configuration (called by primitives)
   */
  public registerCors(config: CorsPrimitiveConfig): void {
    this.registeredConfigs.push(config);
  }

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      // Apply path-specific CORS configs to routes
      for (const config of this.registeredConfigs) {
        if (config.paths) {
          for (const pattern of config.paths) {
            const matchedRoutes = this.serverRouterProvider.getRoutes(pattern);
            for (const route of matchedRoutes) {
              route.cors = this.buildCorsOptions(config);
            }
          }
        }
      }

      if (this.registeredConfigs.length > 0) {
        this.log.info(
          `Initialized with ${this.registeredConfigs.length} registered CORS configurations.`,
        );
      }
    },
  });

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
    handler: ({ route, request }) => {
      // Use route-specific CORS if defined, otherwise use global options
      const corsConfig = route.cors ?? this.globalOptions;
      this.applyCorsHeaders(request, corsConfig);
    },
  });

  /**
   * Build complete CORS options by merging with global defaults
   */
  protected buildCorsOptions(config: CorsPrimitiveConfig): CorsOptions {
    return {
      origin: config.origin ?? this.globalOptions.origin,
      methods: config.methods ?? this.globalOptions.methods,
      headers: config.headers ?? this.globalOptions.headers,
      credentials: config.credentials ?? this.globalOptions.credentials,
      maxAge: config.maxAge ?? this.globalOptions.maxAge,
    };
  }

  /**
   * Apply CORS headers to the response
   */
  protected applyCorsHeaders(
    request: {
      headers: { origin?: string };
      reply: { setHeader: (name: string, value: string) => void };
    },
    options: CorsOptions,
  ): void {
    const reqOrigin = request.headers.origin;
    const { origin, methods, headers, credentials, maxAge } = options;

    if (reqOrigin && this.isOriginAllowed(reqOrigin, origin)) {
      request.reply.setHeader("Access-Control-Allow-Origin", reqOrigin);
    }

    if (credentials) {
      request.reply.setHeader("Access-Control-Allow-Credentials", "true");
    }

    request.reply.setHeader("Access-Control-Allow-Methods", methods.join(", "));
    request.reply.setHeader("Access-Control-Allow-Headers", headers.join(", "));

    if (maxAge != null) {
      request.reply.setHeader("Access-Control-Max-Age", String(maxAge));
    }
  }

  public isOriginAllowed(
    origin: string | undefined,
    allowed: CorsOptions["origin"],
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
