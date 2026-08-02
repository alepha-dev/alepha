import { $atom, $hook, $inject, $store, type Infer, z } from "alepha";
import { CacheProvider } from "alepha/cache";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import {
  HttpError,
  type ServerRequest,
  ServerRouterProvider,
} from "alepha/server";
import type { RateLimitOptions, RateLimitRequest } from "../index.ts";

// ---------------------------------------------------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
  /**
   * The exact counter key this check incremented.
   *
   * Callers that know the request outcome pass it back to
   * {@link ServerRateLimitProvider.refund} so `skipSuccessfulRequests` /
   * `skipFailedRequests` can un-count the request. Recomputing the key later
   * is not safe: the fixed window may have rolled over in between, which would
   * refund the wrong bucket.
   */
  key: string;

  /**
   * Counter lifetime (ms) armed for {@link key}.
   *
   * Carried on the result for the same reason as `key`: a refund must re-arm
   * the identical TTL rather than recompute one from options that may resolve
   * differently, and a counter written with no TTL is never reclaimed.
   */
  ttl: number;
}

/**
 * Rate limit configuration atom (global defaults).
 *
 * Empty by default: merely registering the module must NOT throttle every
 * route (static assets, OPTIONS, health checks included). Set `max` and/or
 * `windowMs` here to opt into a global limit; per-route limits configured
 * via `$rateLimit`/registrations fall back to 100 req / 15 min when they
 * don't specify their own numbers.
 */
export const rateLimitOptions = $atom({
  name: "alepha.server.rate-limit.options",
  schema: z.object({
    windowMs: z.number().describe("Window duration in milliseconds").optional(),
    max: z
      .number()
      .describe("Maximum number of requests per window")
      .optional(),
    skipFailedRequests: z
      .boolean()
      .describe("Skip rate limiting for failed requests")
      .optional(),
    skipSuccessfulRequests: z
      .boolean()
      .describe("Skip rate limiting for successful requests")
      .optional(),
  }),
  default: {},
  serverOnly: true,
});

export type RateLimitAtomOptions = Infer<typeof rateLimitOptions.schema>;

declare module "alepha" {
  interface State {
    [rateLimitOptions.key]: RateLimitAtomOptions;
  }
}

export class ServerRateLimitProvider {
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly serverRouterProvider = $inject(ServerRouterProvider);
  protected readonly cacheProvider = $inject(CacheProvider);
  protected readonly globalOptions = $store(rateLimitOptions);

  protected static readonly CACHE_NAME = "rate-limit";

  /**
   * In-flight route-path checks awaiting their response status, so a refund
   * targets the exact counter key that was incremented.
   */
  protected readonly pending = new WeakMap<
    object,
    { result: RateLimitResult; options: RateLimitOptions }
  >();

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

      // Remember what this request consumed so `onResponse` can refund it once
      // the status is known. A WeakMap keyed on the request keeps the public
      // `ServerRequest` shape unchanged and needs no cleanup.
      if (
        rateLimitConfig.skipFailedRequests ||
        rateLimitConfig.skipSuccessfulRequests
      ) {
        this.pending.set(request, { result, options: rateLimitConfig });
      }
    },
  });

  /**
   * Refund the counter for requests the skip options exclude.
   *
   * Runs on the route path only — the `$rateLimit` middleware wraps the
   * handler and settles its own refund from the thrown/returned outcome.
   */
  public readonly onResponse = $hook({
    on: "server:onResponse",
    handler: async ({ request, response }) => {
      const entry = this.pending.get(request);
      if (!entry) {
        return;
      }
      this.pending.delete(request);
      await this.refund(entry.result, entry.options, {
        failed: (response.status ?? 200) >= 400,
      });
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
    req: RateLimitRequest,
    options: RateLimitOptions = {},
  ): Promise<RateLimitResult> {
    const baseKey = options.keyGenerator?.(req) ?? this.generateKey(req);
    return this.checkLimitByKey(baseKey, options);
  }

  /**
   * Un-count a request whose outcome means it should not consume budget.
   *
   * No-op unless the matching skip option is set, so callers can invoke it
   * unconditionally. Failures are logged and swallowed: a refund that does not
   * land makes the limiter stricter, never weaker, and must not turn a request
   * that already produced its answer into a 500.
   */
  public async refund(
    result: RateLimitResult,
    options: RateLimitOptions,
    outcome: { failed: boolean },
  ): Promise<void> {
    const skip = outcome.failed
      ? options.skipFailedRequests
      : options.skipSuccessfulRequests;

    if (!skip) {
      return;
    }

    try {
      // Same TTL the check armed. A refund can land after the counter expired
      // (the response settles after the window rolled), which re-creates the
      // key — without a TTL that recreated key would then live forever, which
      // is the exact leak the check-side TTL closes.
      await this.cacheProvider.incr(
        ServerRateLimitProvider.CACHE_NAME,
        result.key,
        -1,
        result.ttl,
      );
    } catch (error) {
      this.log.warn("Failed to refund a rate-limit counter", error);
    }
  }

  /**
   * Check rate limit by an explicit key string.
   * Useful when no request context is available (e.g. `$job`, `$pipeline`).
   */
  public async checkLimitByKey(
    baseKey: string,
    options: RateLimitOptions = {},
  ): Promise<RateLimitResult> {
    const windowMs = options.windowMs ?? this.globalOptions.windowMs ?? 900_000;
    const max = options.max ?? this.globalOptions.max ?? 100;

    const now = this.dateTime.nowMillis();
    // Fixed window: round down to nearest window boundary
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const resetTime = windowStart + windowMs;

    // Include window timestamp in key for automatic expiration of old windows
    const key = `${baseKey}:${windowStart}`;

    // A per-window key means the counter is never READ again once the window
    // rolls — but without a TTL it is never RECLAIMED either, so every
    // (identity, window) pair left a key behind forever: an unbounded heap in
    // the memory provider, an unbounded keyspace in Redis/D1. `incr`'s own
    // contract calls this out.
    //
    // Two windows, not one: the counter must comfortably outlive the window it
    // counts (it is armed on creation and never extended, so a one-window TTL
    // would expire mid-window for a counter created near the boundary), and a
    // refund settles after the response. One extra window of garbage-collection
    // lag costs nothing — the key is unreachable the moment its window ends.
    const ttl = windowMs * 2;

    // Atomic increment - returns the new count after incrementing
    const count = await this.cacheProvider.incr(
      ServerRateLimitProvider.CACHE_NAME,
      key,
      1,
      ttl,
    );

    const allowed = count <= max;
    const remaining = Math.max(0, max - count);

    const result: RateLimitResult = {
      allowed,
      limit: max,
      remaining,
      resetTime,
      key,
      ttl,
    };

    if (!allowed) {
      result.retryAfter = Math.ceil((resetTime - now) / 1000);
    }

    return result;
  }

  protected generateKey(req: RateLimitRequest): string {
    // Use req.ip which is resolved by ServerRequestParser with proper trust proxy handling
    return `ip:${req.ip || "unknown"}`;
  }
}
