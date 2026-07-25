import { SchemaValidationError } from "alepha";
import { HttpError } from "./HttpError.ts";

export class ValidationError extends HttpError {
  constructor(message = "Validation has failed", cause?: unknown) {
    let fullMessage = message;
    let details: string | undefined;

    if (cause instanceof SchemaValidationError) {
      const path = cause.cause.instancePath;
      fullMessage = `${message}: ${cause.cause.message}${
        path ? ` (${path})` : ""
      }`;
      if (path) {
        details = path;
      }
    }

    super(
      {
        message: fullMessage,
        status: 400,
        details,
      },
      cause,
    );
  }
}
