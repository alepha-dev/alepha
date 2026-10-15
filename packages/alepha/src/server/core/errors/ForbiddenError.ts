import { HttpError } from "./HttpError.ts";

export class ForbiddenError extends HttpError {
  static readonly code = "ForbiddenError";
  static readonly status = 403;

  static {
    HttpError.register(this);
  }

  readonly name = "ForbiddenError";

  constructor(
    message = "No permission to access this resource",
    cause?: unknown,
  ) {
    super(
      {
        message,
        status: 403,
      },
      cause,
    );
  }
}
