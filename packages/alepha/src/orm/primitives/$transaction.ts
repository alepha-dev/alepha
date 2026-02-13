import { $context, $pipeline } from "alepha";
import { $retry } from "alepha/retry";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PgTransactionConfig } from "drizzle-orm/pg-core/session";
import { DbVersionMismatchError } from "../errors/DbVersionMismatchError.ts";
import { DatabaseProvider } from "../providers/drivers/DatabaseProvider.ts";

/**
 * Creates a transaction primitive for database operations requiring atomicity and consistency.
 *
 * This primitive provides a convenient way to wrap database operations in PostgreSQL
 * transactions, ensuring ACID properties and automatic retry logic for version conflicts.
 * It integrates seamlessly with the repository pattern and provides built-in handling
 * for optimistic locking scenarios with automatic retry on version mismatches.
 *
 * **Important Notes**:
 * - All operations within the transaction handler are atomic
 * - Automatic retry on `PgVersionMismatchError` for optimistic locking
 * - Pass `{ tx }` option to all repository operations within the transaction
 * - Transactions are automatically rolled back on any unhandled error
 * - Use appropriate isolation levels based on your consistency requirements
 */
export const $transaction = <T extends any[], R>(
  opts: TransactionPrimitiveOptions<T, R>,
) => {
  const { alepha } = $context();
  const provider = alepha.inject(DatabaseProvider);

  return $pipeline({
    use: [
      $retry({
        when: (err) => err instanceof DbVersionMismatchError,
      }),
    ],
    handler: (...args: T) =>
      provider.db.transaction(
        async (tx) => opts.handler(tx, ...args),
        opts.config,
      ),
  });
};

// ---------------------------------------------------------------------------------------------------------------------

export interface TransactionPrimitiveOptions<T extends any[], R> {
  /**
   * Transaction handler function that contains all database operations to be executed atomically.
   *
   * This function:
   * - Receives a transaction object as the first parameter
   * - Should pass the transaction to all repository operations via `{ tx }` option
   * - All operations within are automatically rolled back if any error occurs
   * - Has access to the full Alepha dependency injection container
   * - Will be automatically retried if a `PgVersionMismatchError` occurs
   *
   * **Transaction Guidelines**:
   * - Keep transactions as short as possible to minimize lock contention
   * - Always pass the `tx` parameter to repository operations
   * - Handle expected business errors gracefully
   * - Log important operations for debugging and audit trails
   * - Consider the impact of long-running transactions on performance
   *
   * **Error Handling**:
   * - Throwing any error will automatically roll back the transaction
   * - `PgVersionMismatchError` triggers automatic retry logic
   * - Other database errors will be propagated after rollback
   * - Use try-catch within the handler for business-specific error handling
   *
   * @param tx - The PostgreSQL transaction object to use for all database operations
   * @param ...args - Additional arguments passed to the transaction function
   * @returns Promise resolving to the transaction result
   *
   * @example
   * ```ts
   * handler: async (tx, orderId: string, newStatus: string) => {
   *   // Get the current order (with transaction)
   *   const order = await this.orders.findById(orderId, { tx });
   *
   *   // Validate business rules
   *   if (!this.isValidStatusTransition(order.status, newStatus)) {
   *     throw new Error(`Invalid status transition: ${order.status} -> ${newStatus}`);
   *   }
   *
   *   // Update order status (with transaction)
   *   const updatedOrder = await this.orders.updateById(
   *     orderId,
   *     { status: newStatus },
   *     { tx }
   *   );
   *
   *   // Create audit log (with transaction)
   *   await this.auditLogs.create({
   *     id: generateUUID(),
   *     entityId: orderId,
   *     action: 'status_change',
   *     oldValue: order.status,
   *     newValue: newStatus,
   *     timestamp: new Date().toISOString()
   *   }, { tx });
   *
   *   return updatedOrder;
   * }
   * ```
   */
  handler: (tx: PgTransaction<any, any, any>, ...args: T) => Promise<R>;

  /**
   * PostgreSQL transaction configuration options.
   *
   * This allows you to customize transaction behavior including:
   * - **Isolation Level**: Controls visibility of concurrent transaction changes
   * - **Access Mode**: Whether the transaction is read-only or read-write
   * - **Deferrable**: For serializable transactions, allows deferring to avoid conflicts
   *
   * **Isolation Levels**:
   * - **read_uncommitted**: Lowest isolation, allows dirty reads (rarely used)
   * - **read_committed**: Default level, prevents dirty reads
   * - **repeatable_read**: Prevents dirty and non-repeatable reads
   * - **serializable**: Highest isolation, full ACID compliance
   *
   * **Access Modes**:
   * - **read_write**: Default, allows both read and write operations
   * - **read_only**: Only allows read operations, can provide performance benefits
   *
   * **When to Use Different Isolation Levels**:
   * - **read_committed**: Most common operations, good balance of consistency and performance
   * - **repeatable_read**: When you need consistent reads throughout the transaction
   * - **serializable**: Critical financial operations, when absolute consistency is required
   *
   * @example
   * ```ts
   * config: {
   *   isolationLevel: 'serializable',  // Highest consistency for financial operations
   *   accessMode: 'read_write'
   * }
   * ```
   *
   * @example
   * ```ts
   * config: {
   *   isolationLevel: 'read_committed', // Default level for most operations
   *   accessMode: 'read_only'          // Performance optimization for read-only operations
   * }
   * ```
   */
  config?: PgTransactionConfig;
}

export type TransactionContext = PgTransaction<any, any, any>;
