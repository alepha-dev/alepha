import { AlephaError, createMiddleware, type Middleware } from "alepha";

import {
  type CorsOptions,
  ServerCorsProvider,
} from "../providers/ServerCorsProvider.ts";

/**
 * Middleware that applies CORS headers to the response and handles OPTIONS preflight.
 *
 * Reads the request from the ALS context and applies the configured
 * CORS headers via `ServerCorsProvider`. Options are merged with
 * global CORS defaults.
 *
 * For OPTIONS preflight requests, the middleware short-circuits with a 204 response
 * and skips the handler entirely.
 *
 * **Route middleware** - requires a request context (`$action`). Throws if used outside one.
 *
 * ```typescript
 * class ApiController {
 *   getOrders = $action({
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
        const request = alepha.get("alepha.http.request");

        if (!request) {
          throw new AlephaError(
            "$cors requires a request context (use inside $action)",
          );
        }

        const corsConfig = corsProvider.buildCorsOptions(options ?? {});
        corsProvider.applyCorsHeaders(request, corsConfig);

        // OPTIONS preflight → respond immediately, skip handler
        if (request.method === "OPTIONS") {
          request.reply.setStatus(204);
          return;
        }

        return next(...args);
      };
    },
  });
};
