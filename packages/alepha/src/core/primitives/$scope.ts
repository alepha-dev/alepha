import { AlephaError } from "../errors/AlephaError.ts";
import type { Middleware } from "./$pipeline.ts";
import { createMiddleware } from "./$pipeline.ts";

/**
 * Middleware that wraps the handler in an ALS (AsyncLocalStorage) context.
 *
 * Gives the handler its own isolated scope - `alepha.context.get()` / `.set()` are scoped
 * to this execution. Useful for `$pipeline` where no host primitive provides a scope.
 *
 * Host primitives (`$action`, `$job`, `$page`) include `$scope` by default.
 * Adding `$scope()` to their `use` array will throw - you're already in a scope.
 *
 * ```typescript
 * class OrderService {
 *   processOrder = $pipeline({
 *     use: [$scope(), $retry({ max: 3 })],
 *     handler: async (orderId: string) => {
 *       // alepha.context.set/get are scoped here
 *       return await this.orders.updateById(orderId, { status: "paid" });
 *     },
 *   });
 * }
 * ```
 */
export const $scope = (): Middleware => {
  return createMiddleware({
    name: "$scope",
    handler:
      ({ alepha, next }) =>
      async (...args) => {
        if (alepha.context.exists()) {
          throw new AlephaError(
            "$scope: already inside a scope — host primitives ($action, $job, $page) include $scope by default",
          );
        }

        return alepha.context.run(() => next(...args));
      },
  });
};
