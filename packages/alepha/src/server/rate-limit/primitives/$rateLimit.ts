import { createMiddleware, type Middleware } from "alepha";
import { HttpError } from "alepha/server";
import type { RateLimitOptions } from "../index.ts";
import { ServerRateLimitProvider } from "../providers/ServerRateLimitProvider.ts";

export interface RateLimitMiddlewareOptions extends RateLimitOptions {
  /**
   * Custom key function. Receives the handler arguments.
   * When provided, bypasses request-based key generation — works outside `$action`.
   */
  key?: (...args: any[]) => string;
}

/**
 * Middleware that enforces rate limiting.
 *
 * **Key resolution** (in order):
 * 1. Explicit `key` function — user controls the key. Works anywhere (`$action`, `$job`, `$pipeline`).
 * 2. Auto-detect `request.ip` from ALS — default for `$action` context.
 * 3. `"global"` fallback — when no request context and no `key`. All calls share one bucket.
 *
 * Sets `X-RateLimit-*` response headers when a request context is available.
 * Throws `HttpError(429)` when the limit is exceeded.
 *
 * ```typescript
 * // In $action: automatically rate limits by IP
 * $action({ use: [$rateLimit({ max: 100, windowMs: 60000 })] })
 *
 * // In $action: rate limit by custom key
 * $action({ use: [$rateLimit({ max: 10, windowMs: 60000, key: (req) => req.user?.id })] })
 *
 * // In $job: rate limit all executions globally
 * $job({ use: [$rateLimit({ max: 5, windowMs: 3600000 })] })
 * ```
 */
export const $rateLimit = (
  options?: RateLimitMiddlewareOptions,
): Middleware => {
  return createMiddleware({
    name: "$rateLimit",
    options: options as unknown as Record<string, unknown>,
    handler: ({ alepha, next }) => {
      const rateLimitProvider = alepha.inject(ServerRateLimitProvider);

      return async (...args) => {
        const request = alepha.get("alepha.http.request");

        const result = options?.key
          ? await rateLimitProvider.checkLimitByKey(
              options.key(...args),
              options,
            )
          : await rateLimitProvider.checkLimit(
              request ?? { ip: "global", headers: {} },
              options,
            );

        if (request) {
          rateLimitProvider.setRateLimitHeaders(request, result);
        }

        if (!result.allowed) {
          throw new HttpError({
            status: 429,
            message: "Too Many Requests",
          });
        }

        // The middleware wraps the handler, so it observes the outcome
        // directly — no response hook needed, and it works outside HTTP too
        // ($job, $pipeline), where "failed" simply means the handler threw.
        if (!options?.skipFailedRequests && !options?.skipSuccessfulRequests) {
          return next(...args);
        }

        try {
          const value = await next(...args);
          await rateLimitProvider.refund(result, options, { failed: false });
          return value;
        } catch (error) {
          await rateLimitProvider.refund(result, options, {
            failed: !(error instanceof HttpError) || error.status >= 400,
          });
          throw error;
        }
      };
    },
  });
};
