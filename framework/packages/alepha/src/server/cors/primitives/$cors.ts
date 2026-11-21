import { AlephaError, createMiddleware, type Middleware } from "alepha";

import type { CorsOptions } from "../atoms/corsOptions.ts";
import { ServerCorsProvider } from "../providers/ServerCorsProvider.ts";

/**
 * Middleware that applies CORS headers to the response of the route that declares it.
 *
 * Options are merged with the global CORS defaults, and the result replaces
 * the global policy for that route, on the request and on its preflight.
 *
 * The headers go on the response of the action that declares the middleware.
 * When that action is called in process, through `run()` from another route,
 * they stay off the calling route's response: its own policy governs it.
 *
 * The preflight of a routed action is answered by an OPTIONS route generated
 * for its path. The middleware itself answers 204 and skips the handler only
 * when the request it runs on is an OPTIONS request, which is the case of a
 * route declared with `method: "OPTIONS"`.
 *
 * **Route middleware** - requires a request context (`$action`). Throws if used outside one.
 *
 * ```typescript
 * class ApiController {
 *   getOrders = $action({
 *     method: "GET",
 *     path: "/getOrders",
 *     use: [$cors({ origin: "https://app.example.com", credentials: true })],
 *     handler: async ({ query }) => { ... },
 *   });
 * }
 * ```
 */
export const $cors = (options?: Partial<CorsOptions>): Middleware => {
  return createMiddleware({
    name: "$cors",
    options: options as unknown as Record<string, unknown>,
    handler: ({ alepha, next }) => {
      const corsProvider = alepha.inject(ServerCorsProvider);

      return async (...args) => {
        // Same resolution as `$etag`, for the same trap. Inside a nested
        // `run()` the container-wide `alepha.http.request` is the OUTER
        // request: applying this action's allow-list to it removed the grant
        // the outer route was entitled to, or granted an origin the outer
        // route refuses. `run()` publishes its per-call request on its own
        // fork layer, so `"fork"` finds the action that declared this
        // middleware, reading through any layer a `$transactional()` nested
        // in between, and never an enclosing action's.
        const request =
          alepha.store.get("alepha.action.request", "fork") ??
          alepha.get("alepha.http.request");

        if (!request) {
          throw new AlephaError(
            "$cors requires a request context (use inside $action)",
          );
        }

        const corsConfig = corsProvider.buildCorsOptions(options ?? {});
        corsProvider.applyCorsHeaders(request, corsConfig);

        // An OPTIONS request is answered here, without the handler.
        if (request.method === "OPTIONS") {
          request.reply.setStatus(204);
          return;
        }

        return next(...args);
      };
    },
  });
};
