import { SchemaValidationError } from "alepha";

export class FormValidationError extends SchemaValidationError {
  readonly name = "ValidationError";

  constructor(options: { message: string; path: string }) {
    super({
      message: options.message,
      instancePath: options.path,
      params: {},
    });
  }
}
