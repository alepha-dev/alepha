import { AlephaError, createMiddleware, type Middleware } from "alepha";

import {
  DateTimeProvider,
  type DurationLike,
} from "../providers/DateTimeProvider.ts";

/**
 * Middleware that aborts handler execution if it exceeds a duration limit.
 *
 * Uses `Promise.race` with a managed timeout from `DateTimeProvider` -
 * if the handler doesn't resolve before the deadline, the promise rejects.
 * Uses managed timeouts so it works with `DateTimeProvider.travel()` in tests.
 *
 * ```typescript
 * class OrderService {
 *   processOrder = $pipeline({
 *     use: [$timeout([30, "seconds"])],
 *     handler: async (orderId: string) => {
 *       return await this.orders.updateById(orderId, { status: "paid" });
 *     },
 *   });
 * }
 * ```
 */
export const $timeout = (duration: DurationLike): Middleware => {
  return createMiddleware({
    name: "$timeout",
    options: { duration },
    handler: ({ alepha, next }) => {
      const dateTimeProvider = alepha.inject(DateTimeProvider);

      return async (...args) => {
        let rejectTimeout: (reason: Error) => void;
        const timeoutPromise = new Promise<never>((_, reject) => {
          rejectTimeout = reject;
        });

        const timer = dateTimeProvider.createTimeout(() => {
          rejectTimeout(new AlephaError("$timeout: handler exceeded deadline"));
        }, duration);

        try {
          return await Promise.race([next(...args), timeoutPromise]);
        } finally {
          dateTimeProvider.clearTimeout(timer);
        }
      };
    },
  });
};
