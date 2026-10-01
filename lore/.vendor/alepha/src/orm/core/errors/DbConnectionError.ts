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
 */
export class DbConnectionError extends DbError {
  readonly name = "DbConnectionError";
  readonly status = 503;

  /**
   * The type of connection error.
   */
  readonly errorType?:
    | "refused"
    | "timeout"
    | "auth"
    | "not_found"
    | "locked"
    | "unknown";

  /**
   * Whether this error is retryable.
   * Connection errors are often transient and can be retried.
   */
  readonly retryable: boolean;

  constructor(
    message: string,
    cause?: unknown,
    options?: {
      errorType?: DbConnectionError["errorType"];
      retryable?: boolean;
    },
  ) {
    super(message, cause);
    this.errorType = options?.errorType;
    this.retryable = options?.retryable ?? true;
  }

  /**
   * Parse a database connection error message and create a DbConnectionError.
   * Supports both PostgreSQL and SQLite error formats.
   */
  static fromDatabaseError(error: Error): DbConnectionError {
    const message = error.message.toLowerCase();

    // Connection refused
    if (
      message.includes("connection refused") ||
      message.includes("econnrefused") ||
      message.includes("could not connect")
    ) {
      return new DbConnectionError(
        "Database connection refused. Is the server running?",
        error,
        { errorType: "refused", retryable: true },
      );
    }

    // Timeout
    if (
      message.includes("timeout") ||
      message.includes("timed out") ||
      message.includes("etimedout")
    ) {
      return new DbConnectionError("Database connection timed out", error, {
        errorType: "timeout",
        retryable: true,
      });
    }

    // Authentication
    if (
      message.includes("password authentication failed") ||
      message.includes("authentication failed") ||
      message.includes("access denied")
    ) {
      return new DbConnectionError(
        "Database authentication failed. Check credentials.",
        error,
        { errorType: "auth", retryable: false },
      );
    }

    // SQLite file not found
    if (
      message.includes("unable to open database") ||
      message.includes("no such file") ||
      message.includes("enoent")
    ) {
      return new DbConnectionError("Database file not found", error, {
        errorType: "not_found",
        retryable: false,
      });
    }

    // SQLite database locked
    if (message.includes("database is locked")) {
      return new DbConnectionError(
        "Database is locked by another process",
        error,
        { errorType: "locked", retryable: true },
      );
    }

    return new DbConnectionError("Failed to connect to database", error, {
      errorType: "unknown",
      retryable: true,
    });
  }
}
