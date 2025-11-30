import { $atom, $env, $hook, $inject, $use, type Static, t } from "alepha";
import { $cache } from "alepha/cache";
import { $logger } from "alepha/logger";
import {
  HttpError,
  type ServerRequest,
  ServerRouterProvider,
} from "alepha/server";
import type { RateLimitOptions } from "../index.ts";
import type { RateLimitPrimitiveOptions } from "../primitives/$rateLimit.ts";

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
    windowMs: t.optional(
      t.number({
        description: "Window duration in milliseconds",
      }),
    ),
    max: t.optional(
      t.number({
        description: "Maximum number of requests per window",
      }),
    ),
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
  default: {},
});

export type RateLimitAtomOptions = Static<typeof rateLimitOptions.schema>;

declare module "alepha" {
  interface State {
    [rateLimitOptions.key]: RateLimitAtomOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = t.object({
  RATE_LIMIT_WINDOW_MS: t.number({
    default: 15 * 60 * 1000, // 15 minutes
    description: "Rate limit window in milliseconds",
  }),
  RATE_LIMIT_MAX_REQUESTS: t.number({
    default: 100,
    description: "Maximum requests per window",
  }),
});

export class ServerRateLimitProvider {
  protected readonly log = $logger();
  protected readonly serverRouterProvider = $inject(ServerRouterProvider);
  protected readonly env = $env(envSchema);

  protected readonly cache = $cache<RateLimitData>({
    name: "server-rate-limit",
    ttl: [this.env.RATE_LIMIT_WINDOW_MS, "milliseconds"],
  });

  protected readonly globalOptions = $use(rateLimitOptions);

  /**
   * Registered rate limit configurations with their path patterns
   */
  public readonly registeredConfigs: RateLimitPrimitiveOptions[] = [];

  /**
   * Register a rate limit configuration (called by primitives)
   */
  public registerRateLimit(config: RateLimitPrimitiveOptions): void {
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
    config: RateLimitPrimitiveOptions,
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
  protected setRateLimitHeaders(
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
    req: ServerRequest,
    options: RateLimitOptions = {},
  ): Promise<RateLimitResult> {
    const windowMs = options.windowMs ?? this.env.RATE_LIMIT_WINDOW_MS;
    const max = options.max ?? this.env.RATE_LIMIT_MAX_REQUESTS;
    const key = this.generateKey(req);

    const now = Date.now();
    const windowStart = now - windowMs;

    // Get current rate limit data
    const currentData = (await this.cache.get(key)) || {
      count: 0,
      windowStart: now,
      hits: [],
    };

    // Clean old hits outside the current window
    const validHits = currentData.hits.filter(
      (hit: number) => hit >= windowStart,
    );

    // Check if limit exceeded
    const allowed = validHits.length < max;
    const remaining = Math.max(0, max - validHits.length);
    const resetTime = Math.max(...validHits, windowStart) + windowMs;

    // If allowed, record this request
    if (allowed) {
      validHits.push(now);
      await this.cache.set(key, {
        count: validHits.length,
        windowStart: Math.min(currentData.windowStart, windowStart),
        hits: validHits,
      });
    }

    const result: RateLimitResult = {
      allowed,
      limit: max,
      remaining: allowed ? remaining - 1 : remaining,
      resetTime,
    };

    if (!allowed) {
      result.retryAfter = Math.ceil((resetTime - now) / 1000);
    }

    return result;
  }

  protected generateKey(req: ServerRequest): string {
    // Default to IP-based rate limiting
    const ip = this.getClientIP(req);
    return `ip:${ip}`;
  }

  protected getClientIP(req: ServerRequest): string {
    // Check x-forwarded-for header first (for proxies/load balancers)
    const forwarded = req.headers?.["x-forwarded-for"];
    if (forwarded) {
      // x-forwarded-for can contain multiple IPs, get the first one (original client)
      const firstIp = forwarded.split(",")[0].trim();
      if (firstIp) return firstIp;
    }

    return req.ip || "unknown";
  }
}

interface RateLimitData {
  count: number;
  windowStart: number;
  hits: number[];
}
