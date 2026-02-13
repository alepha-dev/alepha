import { AlephaError, createMiddleware, type Middleware } from "alepha";
import { DateTimeProvider, type DurationLike } from "alepha/datetime";

export interface CircuitBreakerOptions {
  /**
   * Consecutive failures before opening the circuit.
   */
  threshold: number;

  /**
   * Cooldown before transitioning from open to half-open.
   */
  reset: DurationLike;
}

/**
 * Middleware that implements the circuit breaker pattern.
 *
 * Three states:
 * - **Closed** (normal) — calls pass through. Failures are counted.
 * - **Open** (tripped) — calls are immediately rejected. No handler execution.
 * - **Half-open** (probing) — one call is allowed. Success closes, failure re-opens.
 *
 * ```typescript
 * class PaymentController {
 *   charge = $action({
 *     use: [$circuit({ threshold: 5, reset: [30, "seconds"] })],
 *     handler: async ({ body }) => this.paymentGateway.charge(body),
 *   });
 * }
 * ```
 */
export const $circuit = (options: CircuitBreakerOptions): Middleware => {
  return createMiddleware({
    name: "$circuit",
    options,
    handler: ({ alepha, next }) => {
      const dateTimeProvider = alepha.inject(DateTimeProvider);
      const resetMs = dateTimeProvider.duration(options.reset).asMilliseconds();

      let state: "closed" | "open" | "half-open" = "closed";
      let failures = 0;
      let openedAt = 0;

      return async (...args) => {
        if (state === "open") {
          if (dateTimeProvider.nowMillis() - openedAt >= resetMs) {
            state = "half-open";
          } else {
            throw new AlephaError("$circuit: circuit is open");
          }
        }

        try {
          const result = await next(...args);
          failures = 0;
          state = "closed";
          return result;
        } catch (error) {
          failures++;
          if (failures >= options.threshold) {
            state = "open";
            openedAt = dateTimeProvider.nowMillis();
          }
          throw error;
        }
      };
    },
  });
};
