import { AlephaError } from "@alepha/core";

export class CommandError extends AlephaError {
  readonly name = "CommandError";
}
