import { AlephaError } from "./AlephaError.ts";

/**
 * Minimal validation-error shape (decoupled from any schema lib).
 */
export interface ValidationErrorLike {
  message: string;
  instancePath?: string;
  params?: unknown;
}

export class SchemaValidationError extends AlephaError {
  name = "SchemaValidationError";

  public readonly cause: ValidationErrorLike;
  public readonly value: {
    path: string;
    message: string;
  };

  constructor(error: ValidationErrorLike) {
    super(
      `Invalid input: ${error.message}${error.instancePath ? ` at ${error.instancePath}` : ""}`,
      {
        cause: error,
      },
    );
    this.value = {
      path: error.instancePath ?? "",
      message: error.message,
    };

    this.cause = error;
  }
}
