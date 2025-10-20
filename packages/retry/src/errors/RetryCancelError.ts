import { AlephaError } from "@alepha/core";

export class RetryCancelError extends AlephaError {
  constructor() {
    super("Retry operation was cancelled.");
    this.name = "RetryCancelError";
  }
}
