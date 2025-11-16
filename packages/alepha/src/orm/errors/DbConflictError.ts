import { DbError } from "./DbError.ts";

export class DbConflictError extends DbError {
  readonly name = "DbConflictError";
  readonly status = 409;
}
