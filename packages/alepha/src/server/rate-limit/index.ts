import { $module } from "alepha";
import { AlephaServer, type ServerRequest } from "alepha/server";
import { ServerRateLimitProvider } from "./providers/ServerRateLimitProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./primitives/$rateLimit.ts";
export * from "./providers/ServerRateLimitProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha/server" {
  interface ActionPrimitiveOptions<TConfig> {
    /**
     * Rate limiting configuration for this action.
     * When specified, the action will be rate limited according to these settings.
     */
    rateLimit?: RateLimitOptions;
  }

  interface ServerRoute {
    /**
     * Route-specific rate limit configuration.
     * If set, overrides the global rate limit options for this route.
     */
    rateLimit?: RateLimitOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The subset of a request the limiter needs.
 *
 * `ip` and `headers` are always present — a `keyGenerator` keying on a header
 * is the common case and must not have to null-check. The rest is optional so
 * the limiter still works outside an HTTP context (`$job`, `$pipeline`), where
 * the caller synthesises a request.
 */
export type RateLimitRequest = Pick<ServerRequest, "ip" | "headers"> &
  Partial<Omit<ServerRequest, "ip" | "headers">>;

export interface RateLimitOptions {
  /**
   * Maximum number of requests per window (default: 100).
   */
  max?: number;
  /**
   * Window duration in milliseconds (default: 15 minutes).
   */
  windowMs?: number;
  /**
   * Custom key generator function.
   *
   * Replaces the default `ip:<address>` bucket. Use it to limit per user,
   * per tenant, or per API key instead of per address:
   *
   * ```typescript
   * $rateLimit({ max: 100, keyGenerator: (req) => `user:${req.user?.id}` })
   * ```
   */
  keyGenerator?: (req: RateLimitRequest) => string;
  /**
   * Do not count requests that ended in an error (status >= 400).
   *
   * The counter is still incremented up front — that is what makes the check
   * atomic — and refunded once the outcome is known.
   */
  skipFailedRequests?: boolean;
  /**
   * Do not count requests that succeeded (status < 400).
   *
   * Typical for login endpoints: only failed attempts should consume the
   * budget. See {@link skipFailedRequests} for the refund mechanics.
   */
  skipSuccessfulRequests?: boolean;
}

/**
 * Request rate limiting on actions.
 *
 * **Features:**
 * - Rate limit configuration per action
 *
 * @module alepha.server.rate-limit
 */
export const AlephaServerRateLimit = $module({
  name: "alepha.server.rate-limit",
  services: [AlephaServer, ServerRateLimitProvider],
});
