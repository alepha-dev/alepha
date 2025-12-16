import { HttpError } from "./HttpError.ts";

export class ForbiddenError extends HttpError {
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
