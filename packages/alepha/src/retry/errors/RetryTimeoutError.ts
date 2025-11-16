import { AlephaError } from "alepha";

export class RetryTimeoutError extends AlephaError {
  constructor(duration: number) {
    super(`Retry operation timed out after ${duration}ms.`);
    this.name = "RetryTimeoutError";
  }
}
