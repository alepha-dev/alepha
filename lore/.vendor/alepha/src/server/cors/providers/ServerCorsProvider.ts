import { $atom, $hook, $inject, $store, type Infer, z } from "alepha";
import { $logger } from "alepha/logger";
import { type ServerRoute, ServerRouterProvider } from "alepha/server";

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
   * Apply CORS headers to the response.
   *
   * **Authoritative, not additive.** A rejected origin gets the two grant
   * headers REMOVED rather than merely not set: this runs more than once per
   * request (the global hook, then a per-action `$cors`), and while the
   * resolution below means the stricter options are normally known by the
   * first pass, a middleware attached after the route was registered is not
   * visible to it. Leaving a previously written `Access-Control-Allow-Origin`
   * standing would hand a rejected origin the grant anyway, which is the whole
   * of what this middleware exists to withhold.
   */
  public applyCorsHeaders(
    request: {
      headers: { origin?: string };
      reply: CorsReply;
    },
    options: CorsOptions,
  ): void {
    const reqOrigin = request.headers.origin;
    const { origin, methods, headers, credentials, maxAge } = options;
    const allowed = !!reqOrigin && this.isOriginAllowed(reqOrigin, origin);

    if (allowed) {
      request.reply.setHeader("Access-Control-Allow-Origin", reqOrigin);
    } else {
      this.removeHeader(request.reply, "Access-Control-Allow-Origin");
    }

    // The response is origin-dependent (we reflect the caller's origin), so a
    // shared cache must not reuse origin A's entry for origin B.
    this.addVaryOrigin(request.reply);

    // Two conditions, both load-bearing:
    //
    // - `allowed`, because a rejected origin used to be told its credentials
    //   were welcome. The browser blocks on the missing `Allow-Origin`, so
    //   nothing leaks, but the response advertised a grant that was refused.
    // - `origin !== "*"`, because a reflected concrete origin + credentials is
    //   what the browser's `*`-with-credentials ban exists to prevent: any
    //   site could then read authenticated responses. Reflecting is only safe
    //   against an allow-list.
    if (allowed && credentials && origin !== "*") {
      request.reply.setHeader("Access-Control-Allow-Credentials", "true");
    } else {
      this.removeHeader(request.reply, "Access-Control-Allow-Credentials");
    }

    request.reply.setHeader("Access-Control-Allow-Methods", methods.join(", "));
    request.reply.setHeader("Access-Control-Allow-Headers", headers.join(", "));

    if (maxAge != null) {
      request.reply.setHeader("Access-Control-Max-Age", String(maxAge));
    }
  }

  /**
   * The CORS options that actually govern a route: its own `cors`, overlaid
   * with whatever a `$cors` middleware on the same route declared.
   *
   * The middleware wins because it is the narrower declaration - it sits on
   * one action, `route.cors` on the route. Returns `undefined` when the route
   * declares neither, which is the caller's signal to fall back to the global
   * options.
   */
  public resolveRouteCors(
    route: ServerRoute,
  ): Partial<CorsOptions> | undefined {
    const fromMiddleware = route.handler?.metadata?.find(
      (it) => it.name === "$cors",
    )?.options as Partial<CorsOptions> | undefined;

    if (!route.cors && !fromMiddleware) {
      return undefined;
    }

    return { ...route.cors, ...fromMiddleware };
  }

  protected removeHeader(reply: CorsReply, name: string): void {
    if (reply.removeHeader) {
      reply.removeHeader(name);
      return;
    }

    if (reply.headers) {
      delete reply.headers[name.toLowerCase()];
    }
  }

  /**
   * Append `Origin` to the `Vary` header without dropping what is already
   * there (`ServerCompressProvider` sets `accept-encoding`).
   */
  protected addVaryOrigin(reply: CorsReply): void {
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

        // The preflight must answer with the SAME grant the real request
        // will. These routes carry no middleware of their own, so a
        // per-action `$cors` allow-list never reached them: the preflight was
        // answered from the global options, and browser and server disagreed
        // about which origins the route accepted.
        //
        // First method on the path wins, matching `covered` above: two methods
        // on one path with different `$cors` allow-lists cannot both be
        // expressed in one preflight answer.
        this.serverRouterProvider.createRoute({
          path: route.path,
          method: "OPTIONS",
          cors: this.resolveRouteCors(route),
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
      // Resolved ONCE, before any header is written. This used to apply the
      // global options and leave the per-action `$cors` middleware to correct
      // them later, which it could not do: `setHeader` overwrites a value but
      // a rejected origin writes no value at all, so the permissive
      // `Access-Control-Allow-Origin` from this pass survived the strict one.
      const routeCors = this.resolveRouteCors(route);
      const corsConfig = routeCors
        ? this.buildCorsOptions(routeCors)
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

/**
 * The reply surface CORS needs. Structural rather than `ServerReply` so the
 * provider stays callable with a stub; `removeHeader` is optional for the
 * same reason, and the provider falls back to deleting off `headers`.
 */
export interface CorsReply {
  headers?: Record<string, string | string[] | undefined>;
  setHeader: (name: string, value: string) => void;
  removeHeader?: (name: string) => void;
}
