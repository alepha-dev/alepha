import { HttpError } from "./HttpError.ts";

export class NotFoundError extends HttpError {
  static readonly code = "NotFoundError";
  static readonly status = 404;

  static {
    HttpError.register(this);
  }

  readonly name = "NotFoundError";

  constructor(message = "Resource not found", cause?: unknown) {
    super(
      {
        message,
        status: 404,
      },
      cause,
    );
  }
}
