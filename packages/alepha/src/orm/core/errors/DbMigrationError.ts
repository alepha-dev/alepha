import { DbError } from "./DbError.ts";

export class DbMigrationError extends DbError {
  readonly name = "DbMigrationError";

  constructor(cause?: unknown) {
    super("Failed to migrate database", cause);
  }
}
