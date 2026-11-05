import { DbError } from "./DbError.ts";

/**
 * A query whose result is larger than the database will return.
 *
 * D1 refuses any single result over 50 MB (from 2026-11-04) with
 * `D1 query result exceeded the maximum response size limit of 50 MB`.
 * 500, not 503: the statement is wrong, not the database slow, and a retry
 * hits the same wall. Bound the read (`limit`, pagination) or select fewer
 * columns.
 *
 * Drizzle demotes the driver's error to `cause`, so the ORM recognises it
 * with `DbErrorParser.resultTooLarge`; once raised, `DbResultTooLargeError.find(error)`
 * finds it in a cause chain like any declared error.
 */
export const DbResultTooLargeError = DbError.extend({
  name: "DB_RESULT_TOO_LARGE",
  default: { status: 500 },
  message:
    "Query result exceeded the database's maximum response size. Bound the " +
    "read with a limit or pagination, or select fewer columns.",
});

export type DbResultTooLargeError = InstanceType<typeof DbResultTooLargeError>;
