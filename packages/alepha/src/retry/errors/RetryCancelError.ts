import { AlephaError } from "alepha";

export class RetryCancelError extends AlephaError {
  constructor() {
    super("Retry operation was cancelled.");
    this.name = "RetryCancelError";
  }
}
