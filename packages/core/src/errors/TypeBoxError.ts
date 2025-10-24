import type { TLocalizedValidationError } from "typebox/error";
import { AlephaError } from "./AlephaError.ts";

export class TypeBoxError extends AlephaError {
  readonly name = "TypeBoxError";

  public readonly cause: TLocalizedValidationError;
  public readonly value: {
    path: string;
    message: string;
  };

  constructor(error: TLocalizedValidationError, value: any) {
    super(
      `Invalid input: ${error.message}${error.instancePath ? ` at ${error.instancePath}` : ""}`,
      {
        cause: error,
      },
    );
    const params = error.params as TypeBoxErrorParams;
    if (params?.requiredProperties) {
      this.value = {
        path: `/${params.requiredProperties[0]}`,
        message: "must be defined",
      };
    } else {
      this.value = {
        path: error.instancePath,
        message: error.message,
      };
    }

    this.cause = error;
  }
}

export interface TypeBoxErrorParams {
  requiredProperties?: string[];
}
