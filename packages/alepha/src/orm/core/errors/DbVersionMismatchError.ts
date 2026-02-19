import { DbError } from "./DbError.ts";

/**
 * Error thrown when there is a version mismatch.
 * It's thrown by {@link Repository#save} when the updated entity version does not match the one in the database.
 * This is used for optimistic concurrency control.
 */
export class DbVersionMismatchError extends DbError {
  readonly name = "DbVersionMismatchError";

  constructor(table: string, id: any) {
    super(`Version mismatch for table '${table}' and id '${id}'`);
  }
}
