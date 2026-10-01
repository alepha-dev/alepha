import { AlephaError } from "alepha";

export class SmsError extends AlephaError {
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = "SmsError";
    this.cause = cause;
  }
}
