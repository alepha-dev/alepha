import { $atom, $hook, $inject, $store, type Infer, z } from "alepha";
import { $logger } from "alepha/logger";
import { ServerRouterProvider } from "alepha/server";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * CORS configuration atom (global defaults)
 */
export const corsOptions = $atom({
  name: "alepha.server.cors.options",
  schema: z.object({
    origin: z
      .string()
      .describe(
        "Allowed origins (* for all, string for single, comma-separated for multiple)",
      )
      .default("*")
      .optional(),
    methods: z
      .array(z.string())
      .describe("Allowed HTTP methods")
      .default(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]),
    headers: z
      .array(z.string())
      .describe("Allowed headers")
      .default(["Content-Type", "Authorization"]),
    credentials: z
      .boolean()
      .describe("Allow credentials")
      .default(false)
      .optional(),
    maxAge: z
      .number()
      .describe("Preflight cache duration in seconds")
      .optional(),
  }),
  default: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    headers: ["Content-Type", "Authorization"],
    credentials: false,
  },
  serverOnly: true,
});

export type CorsOptions = Infer<typeof corsOptions.schema>;

declare module "alepha" {
  interface State {
    [corsOptions.key]: CorsOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class ServerCorsProvider {
  protected readonly log = $logger();
  protected readonly serverRouterProvider = $inject(ServerRouterProvider);
  protected readonly globalOptions = $store(corsOptions);

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      const unsafe =
        this.globalOptions.origin === "*" && this.globalOptions.credentials;

      if (unsafe) {
        this.log.warn(
          'CORS is configured with origin "*" and credentials: true. ' +
            "Credentials are NOT sent for wildcard origins — any site could " +
            "otherwise read authenticated responses. List the allowed origins " +
            "explicitly to enable credentials.",
        );
      }
    },
  });

  /**
   * Build complete CORS options by merging with global defaults
   */
  public buildCorsOptions(config: Partial<CorsOptions>): CorsOptions {
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
  public applyCorsHeaders(
    request: {
      headers: { origin?: string };
      reply: {
        headers?: Record<string, string | string[] | undefined>;
        setHeader: (name: string, value: string) => void;
      };
    },
    options: CorsOptions,
  ): void {
    const reqOrigin = request.headers.origin;
    const { origin, methods, headers, credentials, maxAge } = options;

    if (reqOrigin && this.isOriginAllowed(reqOrigin, origin)) {
      request.reply.setHeader("Access-Control-Allow-Origin", reqOrigin);
    }

    // The response is origin-dependent (we reflect the caller's origin), so a
    // shared cache must not reuse origin A's entry for origin B.
    this.addVaryOrigin(request.reply);

    // A reflected concrete origin + credentials is what the browser's
    // `*`-with-credentials ban exists to prevent: any site could then read
    // authenticated responses. Reflecting is only safe against an allow-list.
    if (credentials && origin !== "*") {
      request.reply.setHeader("Access-Control-Allow-Credentials", "true");
    }

    request.reply.setHeader("Access-Control-Allow-Methods", methods.join(", "));
    request.reply.setHeader("Access-Control-Allow-Headers", headers.join(", "));

    if (maxAge != null) {
      request.reply.setHeader("Access-Control-Max-Age", String(maxAge));
    }
  }

  /**
   * Append `Origin` to the `Vary` header without dropping what is already
   * there (`ServerCompressProvider` sets `accept-encoding`).
   */
  protected addVaryOrigin(reply: {
    headers?: Record<string, string | string[] | undefined>;
    setHeader: (name: string, value: string) => void;
  }): void {
    const current = reply.headers?.vary;
    const values = Array.isArray(current)
      ? current
      : typeof current === "string"
        ? current.split(",")
        : [];

    const parts = values.map((v) => v.trim()).filter(Boolean);

    if (parts.some((v) => v.toLowerCase() === "origin")) {
      return;
    }

    reply.setHeader("Vary", [...parts, "Origin"].join(", "));
  }

  protected readonly configure = $hook({
    on: "start",
    handler: () => {
      const routes = this.serverRouterProvider.getRoutes();

      // Paths that already answer OPTIONS — either declared by the app or
      // created by a previous iteration for a sibling method on the same path.
      const covered = new Set(
        routes.filter((r) => r.method === "OPTIONS").map((r) => r.path),
      );

      for (const route of routes) {
        if (route.method === "OPTIONS" || covered.has(route.path)) {
          continue;
        }

        // GET is preflighted too: any request carrying `Authorization` (in the
        // default allowed headers) is non-simple, so the browser sends OPTIONS
        // first. Skipping GET meant that preflight 404'd with no CORS headers
        // and the browser blocked the real request.
        covered.add(route.path);

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
      // Route-specific CORS (set via `$route({ cors })`) wins over the
      // global options; per-action overrides go through the $cors middleware.
      const corsConfig = route.cors
        ? this.buildCorsOptions(route.cors)
        : this.globalOptions;
      this.applyCorsHeaders(request, corsConfig);
    },
  });

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
