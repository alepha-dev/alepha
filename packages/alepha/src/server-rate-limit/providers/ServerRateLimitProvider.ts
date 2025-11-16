import { $cache } from "alepha/cache";
import { $atom, $env, $hook, $use, type Static, t } from "alepha";
import { HttpError, type ServerRequest } from "alepha/server";

// ---------------------------------------------------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

/**
 * Rate limit configuration atom
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

export type RateLimitOptions = Static<typeof rateLimitOptions.schema>;

declare module "alepha" {
  interface State {
    [rateLimitOptions.key]: RateLimitOptions;
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
  private readonly env = $env(envSchema);

  private readonly cache = $cache<RateLimitData>({
    name: "server-rate-limit",
    ttl: [this.env.RATE_LIMIT_WINDOW_MS, "milliseconds"],
  });

  protected readonly options = $use(rateLimitOptions);

  public readonly onRequest = $hook({
    on: "server:onRequest",
    handler: async ({ request }) => {
      const result = await this.checkLimit(request, this.options);

      if (!result.allowed) {
        // Set rate limit headers
        request.reply.setHeader("X-RateLimit-Limit", result.limit.toString());
        request.reply.setHeader(
          "X-RateLimit-Remaining",
          result.remaining.toString(),
        );
        request.reply.setHeader(
          "X-RateLimit-Reset",
          Math.ceil(result.resetTime / 1000).toString(),
        );

        if (result.retryAfter) {
          request.reply.setHeader("Retry-After", result.retryAfter.toString());
        }

        throw new HttpError({
          status: 429,
          message: "Too Many Requests",
        });
      }

      // Set success headers for allowed requests
      request.reply.setHeader("X-RateLimit-Limit", result.limit.toString());
      request.reply.setHeader(
        "X-RateLimit-Remaining",
        result.remaining.toString(),
      );
      request.reply.setHeader(
        "X-RateLimit-Reset",
        Math.ceil(result.resetTime / 1000).toString(),
      );
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
