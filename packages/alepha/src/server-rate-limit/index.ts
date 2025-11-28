import { $module } from "alepha";
import { AlephaServer } from "alepha/server";
import { $rateLimit } from "./descriptors/$rateLimit.ts";
import { ServerRateLimitProvider } from "./providers/ServerRateLimitProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$rateLimit.ts";
export * from "./providers/ServerRateLimitProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha/server" {
  interface ActionDescriptorOptions<TConfig> {
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
  /** Maximum number of requests per window (default: 100) */
  max?: number;
  /** Window duration in milliseconds (default: 15 minutes) */
  windowMs?: number;
  /** Custom key generator function */
  keyGenerator?: (req: any) => string;
  /** Skip rate limiting for failed requests */
  skipFailedRequests?: boolean;
  /** Skip rate limiting for successful requests */
  skipSuccessfulRequests?: boolean;
}

/**
 * Provides rate limiting capabilities for server routes and actions with configurable limits and windows.
 *
 * The server-rate-limit module enables per-route and per-action rate limiting using either:
 * - The `$rateLimit` descriptor with `paths` option for path-based rate limiting
 * - The `rateLimit` option in action descriptors for action-specific limiting
 *
 * It offers sliding window rate limiting, custom key generation, and seamless integration with server routes.
 *
 * @example
 * ```ts
 * import { $rateLimit, AlephaServerRateLimit } from "alepha/server-rate-limit";
 *
 * class ApiService {
 *   // Path-specific rate limiting
 *   apiRateLimit = $rateLimit({
 *     paths: ["/api/*"],
 *     max: 100,
 *     windowMs: 15 * 60 * 1000, // 15 minutes
 *   });
 * }
 * ```
 *
 * @see {@link $rateLimit}
 * @module alepha.server.rate-limit
 */
export const AlephaServerRateLimit = $module({
  name: "alepha.server.rate-limit",
  descriptors: [$rateLimit],
  services: [AlephaServer, ServerRateLimitProvider],
});
