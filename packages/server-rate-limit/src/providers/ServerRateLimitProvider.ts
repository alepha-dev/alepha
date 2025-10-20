import { $cache } from "@alepha/cache";
import { $env, $hook, t } from "@alepha/core";
import { HttpError, type ServerRequest } from "@alepha/server";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  keyGenerator?: (req: ServerRequest) => string;
  skipFailedRequests?: boolean;
  skipSuccessfulRequests?: boolean;
}

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

  public options: RateLimitOptions = {};

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
      const rateLimit = (action as any).options?.rateLimit;
      if (!rateLimit) {
        return; // No rate limiting for this action
      }

      const result = await this.checkLimit(request, rateLimit);

      if (!result.allowed) {
        // Set rate limit headers
        request.reply?.setHeader("X-RateLimit-Limit", result.limit.toString());
        request.reply?.setHeader(
          "X-RateLimit-Remaining",
          result.remaining.toString(),
        );
        request.reply?.setHeader(
          "X-RateLimit-Reset",
          Math.ceil(result.resetTime / 1000).toString(),
        );

        if (result.retryAfter) {
          request.reply?.setHeader("Retry-After", result.retryAfter.toString());
        }

        throw new HttpError({
          status: 429,
          message: "Too Many Requests",
        });
      }

      // Set success headers for allowed requests
      request.reply?.setHeader("X-RateLimit-Limit", result.limit.toString());
      request.reply?.setHeader(
        "X-RateLimit-Remaining",
        result.remaining.toString(),
      );
      request.reply?.setHeader(
        "X-RateLimit-Reset",
        Math.ceil(result.resetTime / 1000).toString(),
      );
    },
  });

  public async checkLimit(
    req: ServerRequest,
    options: RateLimitOptions = {},
  ): Promise<RateLimitResult> {
    const windowMs = options.windowMs ?? this.env.RATE_LIMIT_WINDOW_MS;
    const max = options.max ?? this.env.RATE_LIMIT_MAX_REQUESTS;
    const key = this.generateKey(req, options.keyGenerator);

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

  private generateKey(
    req: ServerRequest,
    keyGenerator?: (req: ServerRequest) => string,
  ): string {
    if (keyGenerator) {
      return keyGenerator(req);
    }

    // Default to IP-based rate limiting
    const ip = this.getClientIP(req);
    return `ip:${ip}`;
  }

  private getClientIP(req: ServerRequest): string {
    return req.ip || "unknown";
  }
}

interface RateLimitData {
  count: number;
  windowStart: number;
  hits: number[];
}
