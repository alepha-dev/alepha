import { AlephaError } from "./AlephaError.ts";

export class ContainerLockedError extends AlephaError {
  readonly name = "ContainerLockedError";

  constructor(
    message = "Container is locked. No more providers can be added.",
  ) {
    super(message);
  }
}
