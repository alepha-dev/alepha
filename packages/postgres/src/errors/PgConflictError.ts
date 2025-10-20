import { PgError } from "./PgError.ts";

export class PgConflictError extends PgError {
  readonly name = "PgConflictError";
  readonly status = 409;
}
