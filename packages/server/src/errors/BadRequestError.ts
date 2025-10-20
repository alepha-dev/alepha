import { HttpError } from "./HttpError.ts";

export class BadRequestError extends HttpError {
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
