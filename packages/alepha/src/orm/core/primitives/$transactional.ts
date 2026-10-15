import { createMiddleware, type Middleware } from "alepha";

import type { TransactionOptions } from "../interfaces/TransactionOptions.ts";
import { DatabaseProvider } from "../providers/drivers/DatabaseProvider.ts";

/**
 * Options of `$transactional()`: how the transaction runs.
 */
export interface TransactionalOptions {
  /**
   * The SQL isolation level of the transaction. The database's default
   * (`read committed` on Postgres) when omitted; SQLite ignores it.
   */
  isolation?: TransactionOptions["isolation"];

  /**
   * Whether the transaction may write (`read write` when omitted).
   */
  access?: TransactionOptions["access"];
}

/**
 * Middleware that wraps handler execution in a database transaction.
 *
 * All Repository operations inside the handler automatically participate in
 * the transaction - no explicit `{ tx }` drilling required.
 *
 * Nesting joins: inside another `$transactional` block, the handler runs on
 * the outer transaction, and a throw rolls the whole of it back. Options the
 * outer transaction cannot honour throw instead of being ignored: a different
 * `isolation`, or `access: "read write"` inside a `read only` transaction.
 * Set them on the outermost block.
 *
 * ⚠️ **A no-op on a driver without transactions** (Cloudflare D1, PGlite):
 * the handler runs in place, and a throw rolls nothing back. Each primitive
 * logs one warning the first time it runs there. Code that must be correct on
 * D1 guards its writes instead: preconditions in the WHERE, `db.version()`,
 * or an order in which a failure leaves harmless state.
 *
 * ```typescript
 * class OrderService {
 *   createOrder = $action({
 *     use: [$transactional()],
 *     handler: async ({ body }) => {
 *       await this.orders.create(body);      // auto-uses tx
 *       await this.audit.create({ ... });     // auto-uses tx
 *       // throw → rollback, return → commit (not on D1: see above)
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
      // One per primitive: the provider warns once per owner when the driver
      // has no transactions, so the no-op on D1 is never silent.
      const owner = {};
      return async (...args: any[]) => {
        return provider.transactional(() => next(...args), options, owner);
      };
    },
  });
};
