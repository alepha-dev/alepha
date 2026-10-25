import { DbError } from "./DbError.ts";

/**
 * A query was abandoned because it outlived its budget.
 *
 * 503 rather than 500: the database did not reject the statement, it failed
 * to answer in time, and the caller is invited to retry. This mirrors
 * `ServerNotReadyProvider`, which answers 503 with `Retry-After` while the
 * container boots. Drizzle demotes the driver's error to `cause`, so find it
 * with `DbTimeoutError.find(error)`.
 */
export const DbTimeoutError = DbError.extend({
  name: "DB_TIMEOUT",
  default: { status: 503 },
  message: "Database query timed out",
});

export type DbTimeoutError = InstanceType<typeof DbTimeoutError>;
