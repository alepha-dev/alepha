import { DbError } from "./DbError.ts";

/**
 * Error thrown when a table does not exist.
 *
 * This typically happens when:
 * - Migrations haven't been run
 * - Table name is misspelled
 * - Wrong database/schema is being used
 */
export class DbTableNotFoundError extends DbError {
  readonly name = "DbTableNotFoundError";
  readonly status = 500;

  /**
   * The table that was not found.
   */
  readonly table?: string;

  constructor(message: string, cause?: unknown, options?: { table?: string }) {
    super(message, cause);
    this.table = options?.table;
  }

  /**
   * Parse a database table not found error and create a DbTableNotFoundError.
   * Supports both PostgreSQL and SQLite error formats.
   */
  static fromDatabaseError(error: Error): DbTableNotFoundError {
    const message = error.message;

    // PostgreSQL format:
    // 'relation "users" does not exist'
    const pgMatch = message.match(/relation "([^"]+)" does not exist/);

    if (pgMatch) {
      const table = pgMatch[1];
      return new DbTableNotFoundError(
        `Table '${table}' does not exist. Have you run migrations?`,
        error,
        { table },
      );
    }

    // SQLite format:
    // 'no such table: users'
    const sqliteMatch = message.match(/no such table: (\S+)/);

    if (sqliteMatch) {
      const table = sqliteMatch[1];
      return new DbTableNotFoundError(
        `Table '${table}' does not exist. Have you run migrations?`,
        error,
        { table },
      );
    }

    return new DbTableNotFoundError(
      "Table does not exist. Have you run migrations?",
      error,
    );
  }
}
