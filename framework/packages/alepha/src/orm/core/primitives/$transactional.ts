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

  /**
   * Run the block on Cloudflare D1 anyway, in place and without atomicity:
   * a throw rolls nothing back, and one warning is logged. Without it the
   * block throws `DbTransactionUnsupportedError` on D1. Ignored on a driver
   * with transactions.
   */
  allowNonAtomic?: boolean;
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
 * ⚠️ **Refused on Cloudflare D1**, which has no interactive transactions:
 * the block throws `DbTransactionUnsupportedError` instead of running as a
 * silent no-op. Code that must be correct on D1 guards its writes instead:
 * preconditions in the WHERE, `db.version()`, or an order in which a failure
 * leaves harmless state. `allowNonAtomic: true` runs the block there anyway,
 * in place, and a throw rolls nothing back.
 *
 * On PGlite, and in a spec run with `DATABASE_TRANSACTIONS=false`, the block
 * runs in place and each primitive logs one warning the first time.
 *
 * ```typescript
 * class OrderService {
 *   createOrder = $action({
 *     method: "POST",
 *     path: "/createOrder",
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
