import { DbError } from "./DbError.ts";

/**
 * Error thrown when a deadlock is detected.
 *
 * This happens when two or more transactions are waiting for each other
 * to release locks. The database automatically aborts one transaction
 * to resolve the deadlock.
 *
 * This error is useful for implementing retry logic.
 */
export class DbDeadlockError extends DbError {
  readonly name = "DbDeadlockError";
  readonly status = 409;

  /**
   * Whether this error is retryable.
   * Deadlocks are typically safe to retry.
   */
  readonly retryable = true;

  /**
   * Parse a database deadlock error message and create a DbDeadlockError.
   * Supports PostgreSQL. SQLite doesn't have true deadlocks (uses SQLITE_BUSY instead).
   */
  static fromDatabaseError(error: Error): DbDeadlockError {
    return new DbDeadlockError(
      "Transaction deadlock detected. Please retry the operation.",
      error,
    );
  }
}
