import { DbError } from "./DbError.ts";

/**
 * Error thrown when a statement binds more parameters than the driver accepts.
 *
 * Every value in an `inArray` is one bound parameter, so a read over an
 * unbounded list of ids works until the list crosses the driver's ceiling and
 * then fails outright, on data volume rather than on anything the code did.
 * Cloudflare D1 refuses past 100 (`too many SQL variables`); plain SQLite
 * builds cap at `SQLITE_MAX_VARIABLE_NUMBER`; PostgreSQL at 65535.
 *
 * It surfaces as its own error because the generic wrapper hid the driver
 * message entirely: a production incident read `Query select has failed` and
 * said nothing about the ceiling it had just hit. The fix is always the same,
 * so the message says it: split the list into chunks.
 */
export class DbTooManyParametersError extends DbError {
  readonly name = "DbTooManyParametersError";
  readonly status = 400;

  /**
   * Never retryable: the same statement binds the same number of parameters
   * every time. It has to be split, not repeated.
   */
  readonly retryable = false;

  static fromDatabaseError(error: Error): DbTooManyParametersError {
    return new DbTooManyParametersError(
      "Statement binds more parameters than the driver accepts. Split the " +
        "list (an `inArray` binds one parameter per value) into chunks.",
      error,
    );
  }
}
