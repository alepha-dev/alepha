import { PgError } from "./PgError.ts";

/**
 * Error thrown when there is a version mismatch.
 * It's thrown by {@link RepositoryDescriptor#save} when the updated entity version does not match the one in the database.
 * This is used for optimistic concurrency control.
 */
export class PgVersionMismatchError extends PgError {
  readonly name = "PgVersionMismatchError";

  constructor(table: string, id: any) {
    super(`Version mismatch for table '${table}' and id '${id}'`);
  }
}
