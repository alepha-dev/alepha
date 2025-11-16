import { HttpError } from "./HttpError.ts";

export class ConflictError extends HttpError {
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
