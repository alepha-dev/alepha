import { AlephaError } from "./AlephaError.ts";

export class AppNotStartedError extends AlephaError {
  readonly name = "AppNotStartedError";

  constructor() {
    super("App not started. Please start the app before.");
  }
}
