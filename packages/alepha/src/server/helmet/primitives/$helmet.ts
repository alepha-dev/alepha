import { AlephaError, createMiddleware, type Middleware } from "alepha";
import {
  type HelmetOptions,
  ServerHelmetProvider,
} from "../providers/ServerHelmetProvider.ts";

/**
 * Middleware that applies security headers with per-route overrides.
 *
 * Builds headers using `ServerHelmetProvider.buildHeadersFor()` with the
 * provided overrides merged on top of global defaults, then sets them on
 * `request.reply`. The global `onResponse` hook's "don't overwrite" guard
 * skips headers that are already set.
 *
 * **Route middleware** — requires a request context (`$action`). Throws if used outside one.
 *
 * ```typescript
 * class EmbedController {
 *   getWidget = $action({
 *     use: [$helmet({ xFrameOptions: undefined })],
 *     handler: async ({ query }) => { ... },
 *   });
 * }
 * ```
 */
export const $helmet = (options?: Partial<HelmetOptions>): Middleware => {
  return createMiddleware({
    name: "$helmet",
    options: options as unknown as Record<string, unknown>,
    handler: ({ alepha, next }) => {
      const helmetProvider = alepha.inject(ServerHelmetProvider);

      return async (...args) => {
        const request = alepha.get("alepha.http.request");

        if (!request) {
          throw new AlephaError(
            "$helmet requires a request context (use inside $action)",
          );
        }

        const headers = helmetProvider.buildHeadersFor(options);
        for (const [key, value] of Object.entries(headers)) {
          request.reply.setHeader(key, value);
        }

        return next(...args);
      };
    },
  });
};
