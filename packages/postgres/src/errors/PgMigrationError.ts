import { DbError } from "./DbError.ts";

export class PgMigrationError extends DbError {
  readonly name = "PgMigrationError";

  constructor(cause?: unknown) {
    super("Failed to migrate database", cause);
  }
}
