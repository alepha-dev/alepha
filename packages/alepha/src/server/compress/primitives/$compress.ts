import { createMiddleware, type Middleware } from "alepha";
import type { ServerCompressProviderOptions } from "../providers/ServerCompressProvider.ts";

export interface CompressMiddlewareOptions
  extends Partial<ServerCompressProviderOptions> {
  /**
   * Disable compression for this route.
   */
  disabled?: boolean;
}

/**
 * Middleware that configures response compression per-route.
 *
 * Sets per-request compression options in the ALS context.
 * The global `ServerCompressProvider.onResponse` hook reads these
 * and applies them instead of the defaults.
 *
 * Use `disabled: true` to skip compression entirely (e.g. binary downloads).
 * Use `allowedContentTypes` to override which content types get compressed.
 *
 * **Route middleware** — works inside `$action`.
 *
 * ```typescript
 * class DownloadController {
 *   getFile = $action({
 *     use: [$compress({ disabled: true })],
 *     handler: async ({ params }) => { ... },
 *   });
 * }
 * ```
 */
export const $compress = (options?: CompressMiddlewareOptions): Middleware => {
  return createMiddleware({
    name: "$compress",
    options: options as unknown as Record<string, unknown>,
    handler: ({ alepha, next }) => {
      return async (...args) => {
        if (options) {
          alepha.context.set("alepha.server.compress.options", options);
        }
        return next(...args);
      };
    },
  });
};
