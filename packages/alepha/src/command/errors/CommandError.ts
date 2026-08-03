import { AlephaError } from "alepha";

export class CommandError extends AlephaError {
  // Not `readonly`: that infers the literal type `"CommandError"` and a
  // subclass can then never narrow it. `UsageError` needs its own name, and
  // `AlephaError` already declares this field the same way.
  name = "CommandError";
}
