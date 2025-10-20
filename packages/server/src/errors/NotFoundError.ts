import { HttpError } from "./HttpError.ts";

export class NotFoundError extends HttpError {
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
