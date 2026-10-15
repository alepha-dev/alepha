import { HttpError } from "./HttpError.ts";

export class BadRequestError extends HttpError {
  static readonly code = "BadRequestError";

  static {
    HttpError.register(this);
  }

  readonly name = "BadRequestError";

  constructor(message = "Invalid request body", cause?: unknown) {
    super(
      {
        message,
        status: 400,
      },
      cause,
    );
  }
}
