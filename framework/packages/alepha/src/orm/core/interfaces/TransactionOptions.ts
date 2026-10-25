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
}
