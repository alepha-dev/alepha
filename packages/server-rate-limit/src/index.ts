import { $module } from "@alepha/core";
import { AlephaServer } from "@alepha/server";
import { $rateLimit } from "./descriptors/$rateLimit.ts";
import { ServerRateLimitProvider } from "./providers/ServerRateLimitProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$rateLimit.ts";
export * from "./providers/ServerRateLimitProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "@alepha/server" {
  interface ActionDescriptorOptions<TConfig> {
    /**
     * Rate limiting configuration for this action.
     * When specified, the action will be rate limited according to these settings.
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
 * Provides rate limiting capabilities for server actions with configurable limits and windows.
 *
 * The server-rate-limit module enables per-action rate limiting using the `rateLimit` option in action descriptors.
 * It offers sliding window rate limiting, custom key generation, and seamless integration with server routes.
 *
 * @see {@link $rateLimit}
 * @module alepha.server.rate-limit
 */
export const AlephaServerRateLimit = $module({
  name: "alepha.server.rate-limit",
  descriptors: [$rateLimit],
  services: [AlephaServer, ServerRateLimitProvider],
});
