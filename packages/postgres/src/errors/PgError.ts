import { AlephaError } from "@alepha/core";

export class PgError extends AlephaError {
  name = "PgError";

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
  }
}
