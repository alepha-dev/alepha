import type { TLocalizedValidationError } from "typebox/error";
import { AlephaError } from "./AlephaError.ts";

export class TypeBoxError extends AlephaError {
  readonly name = "TypeBoxError";

  public readonly cause: TLocalizedValidationError;
  public readonly value: any;

  constructor(error: TLocalizedValidationError, value: any) {
    super(
      `Invalid input: ${error.message}${error.instancePath ? ` at ${error.instancePath}` : ""}`,
      {
        cause: error,
      },
    );

    this.cause = error;
    this.value = value;
  }
}
