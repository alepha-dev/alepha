import { HttpError } from "alepha/server";

/**
 * The base of every database error: an HTTP error answering 500 unless a
 * descendant says otherwise, so a strict `$action` can declare the ones it
 * expects (`DbEntityNotFoundError`, `DbConflictError`, ...).
 */
export const DbError = HttpError.extend({
  name: "DB",
  default: { status: 500 },
  message: "Database error",
});

export type DbError = InstanceType<typeof DbError>;
