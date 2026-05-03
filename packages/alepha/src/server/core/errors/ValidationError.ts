import { TypeBoxError } from "alepha";
import { HttpError } from "./HttpError.ts";

export class ValidationError extends HttpError {
  constructor(message = "Validation has failed", cause?: unknown) {
    let fullMessage = message;
    let details: string | undefined;

    if (cause instanceof TypeBoxError) {
      fullMessage = `${message}: ${cause.cause.message}`;
      if (cause.cause.instancePath) {
        details = cause.cause.instancePath;
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
