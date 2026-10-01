import { DbError } from "./DbError.ts";

/**
 * Error thrown when there is a version mismatch.
 * It's thrown by {@link Repository#save} when the updated entity version does not match the one in the database.
 * This is used for optimistic concurrency control.
 *
 * Answers 409 Conflict over HTTP: the row changed underneath the request,
 * which is the caller's to resolve by reading it again, not a server fault.
 */
export class DbVersionMismatchError extends DbError {
  readonly name = "DbVersionMismatchError";
  readonly status = 409;

  constructor(table: string, id: any) {
    super(`Version mismatch for table '${table}' and id '${id}'`);
  }
}
