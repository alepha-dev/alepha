import { TypeBoxError } from "alepha";

export class FormValidationError extends TypeBoxError {
  readonly name = "ValidationError";

  constructor(options: {
    message: string;
    path: string;
  }) {
    super({
      message: options.message,
      instancePath: options.path,
      schemaPath: "",
      keyword: "not",
      params: {},
    });
  }
}
