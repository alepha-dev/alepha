import { DbColumnNotFoundError } from "../errors/DbColumnNotFoundError.ts";
import { DbConnectionError } from "../errors/DbConnectionError.ts";
import { DbDeadlockError } from "../errors/DbDeadlockError.ts";
import { DbForeignKeyError } from "../errors/DbForeignKeyError.ts";
import { DbNotNullError } from "../errors/DbNotNullError.ts";
import { DbTableNotFoundError } from "../errors/DbTableNotFoundError.ts";
import { DbTooManyParametersError } from "../errors/DbTooManyParametersError.ts";

/**
 * Turns a driver's error into the database error it describes, reading what
 * it can (table, column, constraint) out of the driver's message.
 *
 * `Repository.handleError` decides which kind an error is; this builds it.
 * A service, so an app with another driver's wording substitutes it.
 */
export class DbErrorParser {
  /**
   * A foreign key violation: a write referencing a missing row, or a delete
   * of a row still referenced.
   */
  public foreignKey(error: Error, tableName: string): DbForeignKeyError {
    const message = error.message;

    // PostgreSQL: 'insert or update on table "x" violates foreign key
    // constraint "fk" ... Key (...) is not present in table "y"' for a
    // dangling reference; 'update or delete on table "x" violates foreign key
    // constraint "fk" on table "y"' for a row still referenced.
    const pgMatch = message.match(
      /violates foreign key constraint "([^"]+)" on table "([^"]+)"/,
    );
    const isDanglingReference = message.includes("is not present in table");

    if (pgMatch) {
      const constraintName = pgMatch[1];
      const referencingTable = pgMatch[2];
      return new DbForeignKeyError(
        { referencingTable, constraintName },
        {
          message: isDanglingReference
            ? `Cannot write ${tableName}: it references a row that does not exist in ${referencingTable}`
            : `Cannot delete ${tableName}: it is referenced by ${referencingTable}`,
          cause: error,
        },
      );
    }

    return new DbForeignKeyError(
      {},
      {
        message: `Foreign key constraint failed on ${tableName}: it either references a missing row, or is still referenced by another entity`,
        cause: error,
      },
    );
  }

  /**
   * A NOT NULL violation, naming the column when the driver does.
   */
  public notNull(error: Error, tableName: string): DbNotNullError {
    const message = error.message;

    const pgMatch = message.match(
      /null value in column "([^"]+)" of relation "([^"]+)" violates not-null constraint/,
    );
    const sqliteMatch = message.match(
      /NOT NULL constraint failed: ([^.]+)\.(\S+)/,
    );

    const column = pgMatch?.[1] ?? sqliteMatch?.[2];
    const table = pgMatch?.[2] ?? sqliteMatch?.[1];

    if (column && table) {
      return new DbNotNullError(
        { column, table },
        {
          message: `Column '${column}' in '${table}' cannot be null`,
          cause: error,
        },
      );
    }

    return new DbNotNullError(
      {},
      {
        message: `A required field in '${tableName}' cannot be null`,
        cause: error,
      },
    );
  }

  /**
   * A deadlock: retrying the transaction usually succeeds.
   */
  public deadlock(error: Error): DbDeadlockError {
    return new DbDeadlockError(undefined, { cause: error });
  }

  /**
   * A statement binding more parameters than the driver accepts.
   */
  public tooManyParameters(error: Error): DbTooManyParametersError {
    return new DbTooManyParametersError(undefined, { cause: error });
  }

  /**
   * A missing column, naming it (and its table) when the driver does.
   */
  public columnNotFound(error: Error): DbColumnNotFoundError {
    const message = error.message;

    // PostgreSQL: column "foo" does not exist
    // PostgreSQL: column "foo" of relation "bar" does not exist
    const pgMatch = message.match(
      /column "([^"]+)"(?: of relation "([^"]+)")? does not exist/,
    );
    if (pgMatch) {
      return new DbColumnNotFoundError(
        { column: pgMatch[1], table: pgMatch[2] },
        { cause: error },
      );
    }

    // SQLite: no such column: foo / no such column: bar.foo
    const sqliteMatch = message.match(/no such column: (?:(\S+)\.)?(\S+)/);
    if (sqliteMatch) {
      return new DbColumnNotFoundError(
        { column: sqliteMatch[2], table: sqliteMatch[1] },
        { cause: error },
      );
    }

    return new DbColumnNotFoundError({}, { cause: error });
  }

  /**
   * A missing table, naming it when the driver does.
   */
  public tableNotFound(error: Error): DbTableNotFoundError {
    const message = error.message;
    const table =
      message.match(/relation "([^"]+)" does not exist/)?.[1] ??
      message.match(/no such table: (\S+)/)?.[1];
    return new DbTableNotFoundError(table ? { table } : {}, { cause: error });
  }

  /**
   * A failed connection, classified by the driver's message.
   */
  public connection(error: Error): DbConnectionError {
    const message = error.message.toLowerCase();
    const has = (...patterns: string[]) =>
      patterns.some((pattern) => message.includes(pattern));

    if (has("connection refused", "econnrefused", "could not connect")) {
      return new DbConnectionError(
        { errorType: "refused", retryable: true },
        {
          message: "Database connection refused. Is the server running?",
          cause: error,
        },
      );
    }
    if (has("timeout", "timed out", "etimedout")) {
      return new DbConnectionError(
        { errorType: "timeout", retryable: true },
        { message: "Database connection timed out", cause: error },
      );
    }
    if (
      has(
        "password authentication failed",
        "authentication failed",
        "access denied",
      )
    ) {
      return new DbConnectionError(
        { errorType: "auth", retryable: false },
        {
          message: "Database authentication failed. Check credentials.",
          cause: error,
        },
      );
    }
    if (has("unable to open database", "no such file", "enoent")) {
      return new DbConnectionError(
        { errorType: "not_found", retryable: false },
        { message: "Database file not found", cause: error },
      );
    }
    if (has("database is locked")) {
      return new DbConnectionError(
        { errorType: "locked", retryable: true },
        { message: "Database is locked by another process", cause: error },
      );
    }
    return new DbConnectionError(
      { errorType: "unknown", retryable: true },
      { cause: error },
    );
  }
}
