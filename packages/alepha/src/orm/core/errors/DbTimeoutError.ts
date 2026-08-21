import { DbError } from "./DbError.ts";

/**
 * A query was abandoned because it outlived its budget.
 *
 * 503 rather than 500: the database did not reject the statement, it failed
 * to answer in time, and the caller is invited to retry. This mirrors
 * `ServerNotReadyProvider`, which answers 503 with `Retry-After` while the
 * container boots.
 */
export class DbTimeoutError extends DbError {
  readonly name = "DbTimeoutError";
  readonly status = 503;

  /**
   * Finds a timeout buried in an error's cause chain.
   *
   * Needed because drizzle catches whatever the driver threw and re-throws
   * its own `Failed query: ...` error with the original demoted to `cause`.
   * Without this the ceiling still fired, but every timeout reached the
   * caller as a generic 500 that read like a broken statement, and the one
   * signal the whole feature exists to produce would have been lost.
   */
  static from(error: unknown): DbTimeoutError | undefined {
    let current: unknown = error;

    // Bounded rather than `while (current)`: an error whose cause chain
    // loops back on itself would otherwise hang the error path, which is
    // the worst possible place to hang.
    for (let depth = 0; depth < 10; depth++) {
      if (current instanceof DbTimeoutError) {
        return current;
      }

      if (!(current instanceof Error) || current.cause === undefined) {
        return undefined;
      }

      current = current.cause;
    }

    return undefined;
  }
}
