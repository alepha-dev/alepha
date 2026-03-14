import { $atom, $hook, $inject, $use, type Static, t } from "alepha";
import { CacheProvider } from "alepha/cache";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import {
  HttpError,
  type ServerRequest,
  ServerRouterProvider,
} from "alepha/server";
import type { RateLimitOptions } from "../index.ts";

// ---------------------------------------------------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

/**
 * Rate limit configuration atom (global defaults)
 */
export const rateLimitOptions = $atom({
  name: "alepha.server.rate-limit.options",
  schema: t.object({
    windowMs: t.number({
      default: 15 * 60 * 1000,
      description: "Window duration in milliseconds",
    }),
    max: t.number({
      default: 100,
      description: "Maximum number of requests per window",
    }),
    skipFailedRequests: t.optional(
      t.boolean({
        description: "Skip rate limiting for failed requests",
      }),
    ),
    skipSuccessfulRequests: t.optional(
      t.boolean({
        description: "Skip rate limiting for successful requests",
      }),
    ),
  }),
  default: {
    windowMs: 15 * 60 * 1000,
    max: 100,
  },
});

export type RateLimitAtomOptions = Static<typeof rateLimitOptions.schema>;

declare module "alepha" {
  interface State {
    [rateLimitOptions.key]: RateLimitAtomOptions;
  }
}

export interface RateLimitRegistration extends RateLimitOptions {
  /**
   * Name identifier for this rate limit.
   */
  name?: string;
  /**
   * Path patterns to match (supports wildcards like /api/*).
   */
  paths?: string[];
}

export class ServerRateLimitProvider {
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly serverRouterProvider = $inject(ServerRouterProvider);
  protected readonly cacheProvider = $inject(CacheProvider);
  protected readonly globalOptions = $use(rateLimitOptions);

  protected static readonly CACHE_NAME = "rate-limit";

  /**
   * Registered rate limit configurations with their path patterns
   */
  public readonly registeredConfigs: RateLimitRegistration[] = [];

  /**
   * Register a rate limit configuration (called by primitives)
   */
  public registerRateLimit(config: RateLimitRegistration): void {
    this.registeredConfigs.push(config);
  }

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      // Apply path-specific rate limit configs to routes
      for (const config of this.registeredConfigs) {
        if (config.paths) {
          for (const pattern of config.paths) {
            const matchedRoutes = this.serverRouterProvider.getRoutes(pattern);
            for (const route of matchedRoutes) {
              route.rateLimit = this.buildRateLimitOptions(config);
            }
          }
        }
      }

      if (this.registeredConfigs.length > 0) {
        this.log.info(
          `Initialized with ${this.registeredConfigs.length} registered rate-limit configurations.`,
        );
      }
    },
  });

  public readonly onRequest = $hook({
    on: "server:onRequest",
    handler: async ({ route, request }) => {
      // Use route-specific rate limit if defined, otherwise use global options
      const rateLimitConfig = route.rateLimit ?? this.globalOptions;

      // Skip if no rate limiting configured
      if (!rateLimitConfig.max && !rateLimitConfig.windowMs) {
        return;
      }

      const result = await this.checkLimit(request, rateLimitConfig);
      this.setRateLimitHeaders(request, result);

      if (!result.allowed) {
        throw new HttpError({
          status: 429,
          message: "Too Many Requests",
        });
      }
    },
  });

  public readonly onActionRequest = $hook({
    on: "action:onRequest",
    handler: async ({ action, request }) => {
      // Check if this action has rate limiting enabled
      const rateLimit = action.options?.rateLimit;
      if (!rateLimit) {
        return; // No rate limiting for this action
      }

      const result = await this.checkLimit(request, rateLimit);

      if (!result.allowed) {
        // Actions are internal - don't set HTTP headers
        // Only throw error to prevent action execution
        throw new HttpError({
          status: 429,
          message: "Too Many Requests",
        });
      }

      // Action allowed - no headers to set since actions are internal
    },
  });

  /**
   * Build complete rate limit options by merging with global defaults
   */
  protected buildRateLimitOptions(
    config: RateLimitRegistration,
  ): RateLimitOptions {
    return {
      max: config.max ?? this.globalOptions.max,
      windowMs: config.windowMs ?? this.globalOptions.windowMs,
      keyGenerator: config.keyGenerator,
      skipFailedRequests:
        config.skipFailedRequests ?? this.globalOptions.skipFailedRequests,
      skipSuccessfulRequests:
        config.skipSuccessfulRequests ??
        this.globalOptions.skipSuccessfulRequests,
    };
  }

  /**
   * Set rate limit headers on the response
   */
  public setRateLimitHeaders(
    request: ServerRequest,
    result: RateLimitResult,
  ): void {
    request.reply.setHeader("X-RateLimit-Limit", result.limit.toString());
    request.reply.setHeader(
      "X-RateLimit-Remaining",
      result.remaining.toString(),
    );
    request.reply.setHeader(
      "X-RateLimit-Reset",
      Math.ceil(result.resetTime / 1000).toString(),
    );

    if (!result.allowed && result.retryAfter) {
      request.reply.setHeader("Retry-After", result.retryAfter.toString());
    }
  }

  public async checkLimit(
    req: Pick<ServerRequest, "ip">,
    options: RateLimitOptions = {},
  ): Promise<RateLimitResult> {
    const baseKey = this.generateKey(req);
    return this.checkLimitByKey(baseKey, options);
  }

  /**
   * Check rate limit by an explicit key string.
   * Useful when no request context is available (e.g. `$job`, `$pipeline`).
   */
  public async checkLimitByKey(
    baseKey: string,
    options: RateLimitOptions = {},
  ): Promise<RateLimitResult> {
    const windowMs = options.windowMs ?? this.globalOptions.windowMs;
    const max = options.max ?? this.globalOptions.max;

    const now = this.dateTime.nowMillis();
    // Fixed window: round down to nearest window boundary
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const resetTime = windowStart + windowMs;

    // Include window timestamp in key for automatic expiration of old windows
    const key = `${baseKey}:${windowStart}`;

    // Atomic increment - returns the new count after incrementing
    const count = await this.cacheProvider.incr(
      ServerRateLimitProvider.CACHE_NAME,
      key,
      1,
    );

    const allowed = count <= max;
    const remaining = Math.max(0, max - count);

    const result: RateLimitResult = {
      allowed,
      limit: max,
      remaining,
      resetTime,
    };

    if (!allowed) {
      result.retryAfter = Math.ceil((resetTime - now) / 1000);
    }

    return result;
  }

  protected generateKey(req: Pick<ServerRequest, "ip">): string {
    // Use req.ip which is resolved by ServerRequestParser with proper trust proxy handling
    return `ip:${req.ip || "unknown"}`;
  }
}
