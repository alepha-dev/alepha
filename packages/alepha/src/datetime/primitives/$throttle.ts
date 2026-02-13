import { createMiddleware, type Middleware } from "alepha";
import {
  DateTimeProvider,
  type DurationLike,
} from "../providers/DateTimeProvider.ts";

export interface ThrottleOptions {
  /**
   * Max calls per window.
   */
  rate: number;

  /**
   * Window duration.
   */
  per: DurationLike;
}

/**
 * Middleware that rate-controls handler execution using a token bucket.
 *
 * Excess calls are **delayed** until capacity is available — never rejected.
 * Process-local (not distributed). Use `$rateLimit` for distributed rate limiting.
 *
 * **Use case**: protect an external API from your own traffic.
 *
 * ```typescript
 * class PaymentController {
 *   charge = $action({
 *     use: [$throttle({ rate: 80, per: [1, "second"] })],
 *     handler: async ({ body }) => this.stripe.charges.create(body),
 *   });
 * }
 * ```
 */
export const $throttle = (options: ThrottleOptions): Middleware => {
  return createMiddleware({
    name: "$throttle",
    options: options as unknown as Record<string, unknown>,
    handler: ({ alepha, next }) => {
      const dateTimeProvider = alepha.inject(DateTimeProvider);
      const intervalMs = dateTimeProvider
        .duration(options.per)
        .asMilliseconds();

      let tokens = options.rate;
      let lastRefill = Date.now();

      return async (...args) => {
        const now = Date.now();
        const elapsed = now - lastRefill;
        const refill = Math.floor(elapsed / intervalMs) * options.rate;

        if (refill > 0) {
          tokens = Math.min(options.rate, tokens + refill);
          lastRefill = now;
        }

        if (tokens <= 0) {
          const waitMs = intervalMs - (now - lastRefill);
          await dateTimeProvider.wait(waitMs);
          tokens = options.rate;
          lastRefill = Date.now();
        }

        tokens--;
        return next(...args);
      };
    },
  });
};
