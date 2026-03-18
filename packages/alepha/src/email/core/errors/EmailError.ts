import { AlephaError } from "alepha";

export class EmailError extends AlephaError {
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = "EmailError";
    this.cause = cause;
  }
}
