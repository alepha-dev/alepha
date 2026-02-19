import { AlephaError } from "alepha";

export class DbError extends AlephaError {
  name = "DbError";

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
  }
}
