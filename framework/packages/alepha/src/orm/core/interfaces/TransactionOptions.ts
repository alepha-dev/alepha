/**
 * How a transaction runs, for `$transactional()` and `Repository.transaction()`.
 *
 * Both fields default to the database's own default (`read committed`,
 * `read write` on Postgres). SQLite has a single isolation level and ignores
 * them.
 */
export interface TransactionOptions {
  /**
   * The SQL isolation level of the transaction.
   */
  isolation?: "read committed" | "repeatable read" | "serializable";

  /**
   * Whether the transaction may write.
   */
  access?: "read write" | "read only";

  /**
   * Run a `$transactional()` block on a driver that refuses one (Cloudflare
   * D1), in place and without atomicity: a throw rolls nothing back. Without
   * it the block throws `DbTransactionUnsupportedError` there. Ignored on a
   * driver with transactions, and by direct `transactional()` calls.
   */
  allowNonAtomic?: boolean;
}
