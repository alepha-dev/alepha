import { createMiddleware, type Middleware } from "alepha";
import type { PgTransactionConfig } from "drizzle-orm/pg-core/session";
import { DatabaseProvider } from "../providers/drivers/DatabaseProvider.ts";

export interface TransactionalOptions {
  /**
   * PostgreSQL transaction configuration (isolation level, access mode, etc.).
   */
  config?: PgTransactionConfig;
}

// TODO: support savepoints for nested transactions.
//   Today, a nested $transactional reuses the outer tx (correct for ACID), but
//   there is no way to roll back ONLY the inner block while preserving the
//   outer one. Drizzle exposes savepoints (`tx.transaction(...)` inside an
//   existing tx maps to `SAVEPOINT` on Postgres). Plan:
//     1. Detect "already inside a tx" in DatabaseProvider.transactional().
//     2. When nested, open a savepoint instead of reusing the outer scope.
//     3. On inner throw, ROLLBACK TO SAVEPOINT (don't bubble unless re-thrown).
//     4. Add an option { savepoint?: boolean } on $transactional (default true
//        when nested) so users can opt out for "inherit-and-bubble" semantics.
//   Needs care around connection-bound state and Drizzle's tx proxy.
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
