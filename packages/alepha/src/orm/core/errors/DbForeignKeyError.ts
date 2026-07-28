import { DbError } from "./DbError.ts";

/**
 * Error thrown when a foreign key constraint is violated.
 *
 * This typically happens when trying to delete an entity that is
 * referenced by another entity.
 */
export class DbForeignKeyError extends DbError {
  readonly name = "DbForeignKeyError";
  readonly status = 409;

  /**
   * The table that references the entity being deleted.
   */
  readonly referencingTable?: string;

  /**
   * The constraint name that was violated.
   */
  readonly constraintName?: string;

  constructor(
    message: string,
    cause?: unknown,
    options?: { referencingTable?: string; constraintName?: string },
  ) {
    super(message, cause);
    this.referencingTable = options?.referencingTable;
    this.constraintName = options?.constraintName;
  }

  /**
   * Parse a database foreign key error message and create a DbForeignKeyError.
   * Supports both PostgreSQL and SQLite error formats.
   */
  static fromDatabaseError(error: Error, tableName: string): DbForeignKeyError {
    const message = error.message;

    // PostgreSQL format:
    // 'violates foreign key constraint "reporting_alert_query_id_fk" on table "reporting_alert"'
    const pgMatch = message.match(
      /violates foreign key constraint "([^"]+)" on table "([^"]+)"/,
    );

    // Which side of the constraint failed. An INSERT/UPDATE naming a row that
    // does not exist is "is not present in table"; a DELETE/UPDATE that would
    // orphan children is "is still referenced". Reporting both as "Cannot
    // delete" sent readers looking for a delete that never happened.
    const isDanglingReference = message.includes("is not present in table");

    if (pgMatch) {
      const constraintName = pgMatch[1];
      const referencingTable = pgMatch[2];

      return new DbForeignKeyError(
        isDanglingReference
          ? `Cannot write ${tableName}: it references a row that does not exist in ${referencingTable}`
          : `Cannot delete ${tableName}: it is referenced by ${referencingTable}`,
        error,
        { referencingTable, constraintName },
      );
    }

    // SQLite format:
    // 'FOREIGN KEY constraint failed' (no table name available, and no way to
    // tell the two directions apart)
    return new DbForeignKeyError(
      `Foreign key constraint failed on ${tableName}: it either references a missing row, or is still referenced by another entity`,
      error,
    );
  }
}
