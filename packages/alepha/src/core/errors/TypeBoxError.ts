/** Minimal validation-error shape (decoupled from any schema lib). */
export interface ValidationErrorLike {
  message: string;
  instancePath?: string;
  params?: unknown;
}

import { AlephaError } from "./AlephaError.ts";

export class TypeBoxError extends AlephaError {
  name = "TypeBoxError";

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
    const params = error.params as TypeBoxErrorParams;
    if (params?.requiredProperties) {
      this.value = {
        path: `/${params.requiredProperties[0]}`,
        message: "must be defined",
      };
    } else {
      this.value = {
        path: error.instancePath ?? "",
        message: error.message,
      };
    }

    this.cause = error;
  }
}

export interface TypeBoxErrorParams {
  requiredProperties?: string[];
}
