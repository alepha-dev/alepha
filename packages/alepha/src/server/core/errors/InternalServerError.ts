import { HttpError } from "./HttpError.ts";

/**
 * A 500: the server failed in a way the caller cannot act on.
 *
 * Its code is the one `ServerRouterProvider.errorHandler` already answers an
 * unknown crash with, so a `$action` in strict mode (`errors` declared) that
 * turns an undeclared error into this class answers byte for byte like any
 * other crash. The original error is kept as `cause`; the router strips the
 * message, details and cause of every 5xx in production.
 */
export class InternalServerError extends HttpError {
  static readonly code = "InternalServerError";

  static {
    HttpError.register(this);
  }

  readonly name = "InternalServerError";

  constructor(message = "Internal Server Error", cause?: unknown) {
    super(
      {
        message,
        status: 500,
      },
      cause,
    );
  }
}
