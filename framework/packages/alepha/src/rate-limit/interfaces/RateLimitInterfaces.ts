import type { DurationLike } from "alepha/datetime";

/**
 * What to do when the counter store cannot answer: refuse (`deny`, the
 * default, fail closed) or let the call through uncounted (`allow`).
 */
export type RateLimitFailureMode = "deny" | "allow";

export interface RateLimitPrimitiveOptions<TInput = string> {
  /**
   * Unique per container: the counters' namespace. Two limiters with one name
   * would share counters silently, so the second declaration throws.
   */
  name: string;
  /**
   * Hits allowed per window, or a synchronous function of the consume input.
   */
  limit: number | ((input: TInput) => number);
  /**
   * Window length (`60_000`, `[15, "minutes"]`), or a synchronous function of
   * the consume input.
   */
  window: DurationLike | ((input: TInput) => DurationLike);
  /**
   * `fixed` (the default and only one built): a window opens on its first hit
   * and lasts `window`. `sliding` is reserved.
   */
  algorithm?: "fixed";
  /**
   * The counter key within this limiter. Defaults to the input itself, which
   * must then be a string.
   */
  key?: (input: TInput) => string;
  /**
   * A store error (transport, Durable Object RPC, decode). Default `deny`.
   */
  onStoreError?: RateLimitFailureMode;
  /**
   * `ActorContentionError` (Redis compare-and-set exhausted). Default `deny`.
   */
  onContention?: RateLimitFailureMode;
}

export interface RateLimitMiddlewareOptions {
  /**
   * The key from the handler's arguments. Without it: `ip:<request.ip>` in an
   * HTTP request, else `ip:global`.
   */
  key?: (...args: any[]) => string;
  /**
   * Refund the hit when the handler fails (throws anything but an
   * `HttpError` below 400).
   */
  skipFailedRequests?: boolean;
  /**
   * Refund the hit when the handler succeeds: only failures count, as on a
   * login endpoint.
   */
  skipSuccessfulRequests?: boolean;
}

/**
 * Proof that a consume was counted, and the only way to refund it. It pins the
 * window it was counted in: a refund after the window rolled does nothing.
 */
export interface RateLimitTicket {
  name: string;
  key: string;
  resetAt: number;
  limit: number;
}

/**
 * Counted and allowed.
 */
export interface RateLimitCounted {
  allowed: true;
  reason?: undefined;
  count: number;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterMs?: undefined;
  ticket: RateLimitTicket;
}

/**
 * Refused because the window is full.
 */
export interface RateLimitRefused {
  allowed: false;
  reason: "limit";
  count: number;
  limit: number;
  remaining: 0;
  resetAt: number;
  retryAfterMs: number;
  ticket?: undefined;
}

/**
 * The store failed or contended: refused under `deny`, allowed under `allow`.
 * Nothing was counted, so there is no ticket.
 */
export interface RateLimitUnavailable {
  allowed: boolean;
  reason: "store" | "contention";
  limit: number;
  count?: undefined;
  remaining?: undefined;
  resetAt?: undefined;
  retryAfterMs?: undefined;
  ticket?: undefined;
}

export type RateLimitResult =
  | RateLimitCounted
  | RateLimitRefused
  | RateLimitUnavailable;
