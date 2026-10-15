import { z } from "alepha";

import { DbError } from "./DbError.ts";

/**
 * Error thrown when a database connection fails.
 *
 * This can happen due to:
 * - Connection refused (server not running)
 * - Connection timeout
 * - Authentication failure
 * - Network issues
 * - Database file not found (SQLite)
 *
 * `DbErrorParser.connection` classifies a driver's error into one.
 */
export const DbConnectionError = DbError.extend({
  name: "DB_CONNECTION",
  default: { status: 503, retryable: true },
  schema: z.object({
    errorType: z
      .enum(["refused", "timeout", "auth", "not_found", "locked", "unknown"])
      .optional(),
    retryable: z.boolean(),
  }),
  message: "Failed to connect to database",
});

export type DbConnectionError = InstanceType<typeof DbConnectionError>;
