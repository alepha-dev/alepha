import { DbError } from "./DbError.ts";

export class PgConflictError extends DbError {
  readonly name = "PgConflictError";
  readonly status = 409;
}
