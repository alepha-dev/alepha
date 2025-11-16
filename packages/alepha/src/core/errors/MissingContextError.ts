import { AlephaError } from "./AlephaError.ts";

export class MissingContextError extends AlephaError {
  readonly name = "MissingContextError";

  constructor() {
    super("Missing context. Did you forget to call Alepha.create()?");
    this.name = "MissingContextError";
  }
}
