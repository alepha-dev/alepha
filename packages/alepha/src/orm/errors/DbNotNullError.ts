import { DbError } from "./DbError.ts";

/**
 * Error thrown when a NOT NULL constraint is violated.
 *
 * This happens when inserting or updating a NULL value into a column
 * that has a NOT NULL constraint.
 */
export class DbNotNullError extends DbError {
  readonly name = "DbNotNullError";
  readonly status = 400;

  /**
   * The column that violated the NOT NULL constraint.
   */
  readonly column?: string;

  /**
   * The table containing the column.
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
   * Parse a database NOT NULL error message and create a DbNotNullError.
   * Supports both PostgreSQL and SQLite error formats.
   */
  static fromDatabaseError(error: Error, tableName: string): DbNotNullError {
    const message = error.message;

    // PostgreSQL format:
    // 'null value in column "email" of relation "users" violates not-null constraint'
    const pgMatch = message.match(
      /null value in column "([^"]+)" of relation "([^"]+)" violates not-null constraint/,
    );

    if (pgMatch) {
      const column = pgMatch[1];
      const table = pgMatch[2];
      return new DbNotNullError(
        `Column '${column}' in '${table}' cannot be null`,
        error,
        { column, table },
      );
    }

    // SQLite format:
    // 'NOT NULL constraint failed: users.email'
    const sqliteMatch = message.match(
      /NOT NULL constraint failed: ([^.]+)\.(\S+)/,
    );

    if (sqliteMatch) {
      const table = sqliteMatch[1];
      const column = sqliteMatch[2];
      return new DbNotNullError(
        `Column '${column}' in '${table}' cannot be null`,
        error,
        { column, table },
      );
    }

    return new DbNotNullError(
      `A required field in '${tableName}' cannot be null`,
      error,
    );
  }
}
