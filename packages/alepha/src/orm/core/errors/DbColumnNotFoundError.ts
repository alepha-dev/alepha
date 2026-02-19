import { DbError } from "./DbError.ts";

/**
 * Error thrown when a column does not exist.
 *
 * This typically happens when:
 * - Column name is misspelled
 * - Migrations haven't been run
 * - Using wrong schema version
 */
export class DbColumnNotFoundError extends DbError {
  readonly name = "DbColumnNotFoundError";
  readonly status = 500;

  /**
   * The column that was not found.
   */
  readonly column?: string;

  /**
   * The table where the column was expected.
   */
  readonly table?: string;

  constructor(
    message: string,
    cause?: unknown,
    options?: { column?: string; table?: string },
  ) {
    super(message, cause);
    this.column = options?.column;
    this.table = options?.table;
  }

  /**
   * Parse a database column not found error and create a DbColumnNotFoundError.
   * Supports both PostgreSQL and SQLite error formats.
   */
  static fromDatabaseError(error: Error): DbColumnNotFoundError {
    const message = error.message;

    // PostgreSQL format:
    // 'column "foo" does not exist'
    // 'column "foo" of relation "users" does not exist'
    const pgMatch = message.match(
      /column "([^"]+)"(?: of relation "([^"]+)")? does not exist/,
    );

    if (pgMatch) {
      const column = pgMatch[1];
      const table = pgMatch[2];
      const msg = table
        ? `Column '${column}' does not exist in table '${table}'`
        : `Column '${column}' does not exist`;
      return new DbColumnNotFoundError(msg, error, { column, table });
    }

    // SQLite format:
    // 'no such column: foo'
    // 'no such column: users.foo'
    const sqliteMatch = message.match(/no such column: (?:(\S+)\.)?(\S+)/);

    if (sqliteMatch) {
      const table = sqliteMatch[1];
      const column = sqliteMatch[2];
      const msg = table
        ? `Column '${column}' does not exist in table '${table}'`
        : `Column '${column}' does not exist`;
      return new DbColumnNotFoundError(msg, error, { column, table });
    }

    return new DbColumnNotFoundError("Column does not exist", error);
  }
}
