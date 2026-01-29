import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { $rateLimit } from "./primitives/$rateLimit.ts";
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
   */
  keyGenerator?: (req: any) => string;
  /**
   * Skip rate limiting for failed requests.
   */
  skipFailedRequests?: boolean;
  /**
   * Skip rate limiting for successful requests.
   */
  skipSuccessfulRequests?: boolean;
}

/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | backend | standard | stable |
 *
 * Request rate limiting on actions.
 *
 * **Features:**
 * - Rate limit configuration per action
 *
 * @module alepha.server.rate-limit
 */
export const AlephaServerRateLimit = $module({
  name: "alepha.server.rate-limit",
  primitives: [$rateLimit],
  services: [AlephaServer, ServerRateLimitProvider],
});
