import { createMiddleware, type Middleware } from "alepha";
import type { PgTransactionConfig } from "drizzle-orm/pg-core/session";
import { DatabaseProvider } from "../providers/drivers/DatabaseProvider.ts";

export interface TransactionalOptions {
  /**
   * PostgreSQL transaction configuration (isolation level, access mode, etc.).
   */
  config?: PgTransactionConfig;
}

/**
 * Middleware that wraps handler execution in a database transaction.
 *
 * All Repository operations inside the handler automatically participate in
 * the transaction — no explicit `{ tx }` drilling required.
 *
 * Nesting is safe: if the handler is already inside a `transactional()` block,
 * the outer transaction is reused.
 *
 * ```typescript
 * class OrderService {
 *   createOrder = $action({
 *     use: [$transactional()],
 *     handler: async ({ body }) => {
 *       await this.orders.create(body);      // auto-uses tx
 *       await this.audit.create({ ... });     // auto-uses tx
 *       // throw → auto rollback, return → auto commit
 *     },
 *   });
 * }
 * ```
 */
export const $transactional = (options?: TransactionalOptions): Middleware => {
  return createMiddleware({
    name: "$transactional",
    options,
    handler: ({ alepha, next }) => {
      const provider = alepha.inject(DatabaseProvider);
      return async (...args: any[]) => {
        return provider.transactional(() => next(...args), options?.config);
      };
    },
  });
};
