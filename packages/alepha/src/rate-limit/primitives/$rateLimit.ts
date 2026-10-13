import { $inject, AlephaError, createPrimitive, KIND, Primitive } from "alepha";
import { ActorContentionError } from "alepha/actor";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";

import type {
  RateLimitPrimitiveOptions,
  RateLimitResult,
  RateLimitTicket,
} from "../interfaces/RateLimitInterfaces.ts";
import { RateLimitWindows } from "../services/RateLimitWindows.ts";

/**
 * Declare a transport-agnostic, fail-closed rate limiter.
 *
 * Counters are actor state (`alepha/actor`), so topology is the actor
 * provider's: Memory is one instance, `AlephaActorRedis` is several, and a
 * Durable Object on workerd. An app that runs several instances without Redis
 * counts per instance.
 *
 * `consume(input)` counts one hit in a fixed window anchored on its first hit.
 * A counted result carries a `ticket`; `refund(ticket)` gives that hit back,
 * within the same window only, and never throws. A refused hit is not counted:
 * past the limit the counter saturates and a flood costs reads, not writes.
 *
 * `limit`, `window` and `key` are numbers or synchronous functions of the
 * consume input: load anything asynchronous (realm settings) before consuming
 * and pass it in. A store error or `ActorContentionError` resolves a result
 * with `reason: "store" | "contention"`, refused under `deny` (the default for
 * both) or allowed uncounted under `allow`. `consume` never rejects for them.
 *
 * Every refusal emits `rate-limit:consume:denied`. Callers audit lockouts
 * themselves from `count`: whether a hit "crossed" depends on whether they
 * compare before or after counting.
 *
 * @example
 * ```ts check
 * import { $rateLimit } from "alepha/rate-limit";
 *
 * interface Attempt {
 *   userId: string;
 *   max: number;
 * }
 *
 * class Auth {
 *   account = $rateLimit({
 *     name: "login:account",
 *     limit: (input: Attempt) => input.max,
 *     window: [15, "minutes"],
 *     key: (input: Attempt) => input.userId,
 *   });
 *
 *   async attempt(userId: string, ok: () => Promise<boolean>) {
 *     const result = await this.account.consume({ userId, max: 5 });
 *     if (!result.allowed) return false;
 *     if (!(await ok())) return false;
 *     if (result.ticket) await this.account.refund(result.ticket);
 *     return true;
 *   }
 * }
 * ```
 */
export const $rateLimit = <TInput = string>(
  options: RateLimitPrimitiveOptions<TInput>,
): RateLimitPrimitive<TInput> => {
  return createPrimitive(
    RateLimitPrimitive<TInput>,
    options,
  ) as RateLimitPrimitive<TInput>;
};

export class RateLimitPrimitive<TInput = string> extends Primitive<
  RateLimitPrimitiveOptions<TInput>
> {
  protected readonly log = $logger();
  protected readonly windows = $inject(RateLimitWindows);
  protected readonly dateTime = $inject(DateTimeProvider);

  protected override onInit(): void {
    const { name, algorithm, onStoreError, onContention } = this.options;
    if (typeof name !== "string" || !name)
      throw new AlephaError("A rate limiter needs a nonempty name");
    if (algorithm !== undefined && algorithm !== "fixed")
      throw new AlephaError(
        `Rate limiter '${name}': only the fixed algorithm exists`,
      );
    for (const mode of [onStoreError, onContention])
      if (mode !== undefined && mode !== "deny" && mode !== "allow")
        throw new AlephaError(
          `Rate limiter '${name}': failure modes are "deny" or "allow"`,
        );
    this.windows.register(name);
  }

  public get name(): string {
    return this.options.name;
  }

  /**
   * Count one hit for `input`. Resolves, never rejects for a store failure.
   * Misconfiguration (a non-string input without `key`, a limit that is not a
   * nonnegative integer, a window under 1 ms) throws.
   */
  public async consume(input: TInput): Promise<RateLimitResult> {
    const { name } = this.options;
    const limit = this.resolveLimit(input);
    const windowMs = this.resolveWindow(input);
    const key = this.resolveKey(input);
    const now = this.dateTime.nowMillis();
    let state: { count: number; resetAt: number };
    try {
      state = await this.windows.window
        .get(`${name}:${key}`)
        .hit(now, windowMs, limit);
    } catch (error) {
      return this.unavailable(key, limit, error);
    }
    if (state.count <= limit)
      return {
        allowed: true,
        count: state.count,
        limit,
        remaining: limit - state.count,
        resetAt: state.resetAt,
        ticket: { name, key, resetAt: state.resetAt, limit },
      };
    await this.denied(key, "limit");
    return {
      allowed: false,
      reason: "limit",
      count: state.count,
      limit,
      remaining: 0,
      resetAt: state.resetAt,
      retryAfterMs: Math.max(0, state.resetAt - now),
    };
  }

  /**
   * Give a counted hit back. Does nothing once its window has rolled. Never
   * throws: a refund that fails is logged and makes the limiter stricter,
   * never weaker.
   */
  public async refund(ticket: RateLimitTicket): Promise<void> {
    try {
      if (ticket.name !== this.options.name)
        throw new AlephaError(
          `Ticket of '${ticket.name}' refunded on '${this.options.name}'`,
        );
      await this.windows.window
        .get(`${ticket.name}:${ticket.key}`)
        .refund(ticket.resetAt, ticket.limit);
    } catch (error) {
      this.log.warn("Failed to refund a rate-limit ticket", {
        name: ticket.name,
        key: ticket.key,
        error,
      });
    }
  }

  protected async unavailable(
    key: string,
    limit: number,
    error: unknown,
  ): Promise<RateLimitResult> {
    const reason =
      error instanceof ActorContentionError ? "contention" : "store";
    const mode =
      (reason === "contention"
        ? this.options.onContention
        : this.options.onStoreError) ?? "deny";
    this.log.error(`Rate limiter '${this.options.name}' unavailable`, {
      key,
      reason,
      mode,
      error,
    });
    if (mode === "allow") return { allowed: true, reason, limit };
    await this.denied(key, reason);
    return { allowed: false, reason, limit };
  }

  protected async denied(
    key: string,
    reason: "limit" | "store" | "contention",
  ): Promise<void> {
    await this.alepha.events.emit("rate-limit:consume:denied", {
      name: this.options.name,
      key,
      reason,
    });
  }

  protected resolveLimit(input: TInput): number {
    const { limit } = this.options;
    const value = typeof limit === "function" ? limit(input) : limit;
    if (!Number.isSafeInteger(value) || value < 0)
      throw new AlephaError(
        `Rate limiter '${this.options.name}': limit must be a nonnegative integer`,
      );
    return value;
  }

  protected resolveWindow(input: TInput): number {
    const { window } = this.options;
    const value = typeof window === "function" ? window(input) : window;
    const ms = Math.floor(this.dateTime.duration(value).asMilliseconds());
    if (!Number.isSafeInteger(ms) || ms < 1)
      throw new AlephaError(
        `Rate limiter '${this.options.name}': window must be at least 1 ms`,
      );
    return ms;
  }

  protected resolveKey(input: TInput): string {
    const key = this.options.key ? this.options.key(input) : input;
    if (typeof key !== "string" || !key)
      throw new AlephaError(
        `Rate limiter '${this.options.name}': the key must be a nonempty string (pass a key function for a non-string input)`,
      );
    return key;
  }
}

$rateLimit[KIND] = RateLimitPrimitive;
