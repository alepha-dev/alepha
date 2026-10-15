import { HttpError } from "./HttpError.ts";

export class UnauthorizedError extends HttpError {
  static readonly code = "UnauthorizedError";

  static {
    HttpError.register(this);
  }

  readonly name = "UnauthorizedError";

  constructor(
    message = "Not allowed to access this resource",
    cause?: unknown,
  ) {
    super(
      {
        message,
        status: 401,
      },
      cause,
    );
  }
}
