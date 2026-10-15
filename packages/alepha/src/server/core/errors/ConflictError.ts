import { HttpError } from "./HttpError.ts";

export class ConflictError extends HttpError {
  static readonly code = "ConflictError";
  static readonly status = 409;

  static {
    HttpError.register(this);
  }

  readonly name = "ConflictError";

  constructor(message = "Entity already exists", cause?: unknown) {
    super(
      {
        message,
        status: 409,
      },
      cause,
    );
  }
}
