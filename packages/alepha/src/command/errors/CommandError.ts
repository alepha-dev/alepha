import { AlephaError } from "alepha";

export class CommandError extends AlephaError {
  readonly name = "CommandError";
}
