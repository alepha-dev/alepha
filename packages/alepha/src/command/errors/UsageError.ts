import { CommandError } from "./CommandError.ts";

/**
 * The user typed something the CLI cannot accept: an unknown flag, a flag
 * missing its value, an argument that fails its schema, a required environment
 * variable that is unset.
 *
 * Split from {@link CommandError} because the two deserve opposite treatment.
 * A `CommandError` from {@link Runner} means a task genuinely failed and its
 * stack is the useful part. A `UsageError` means nothing ran yet — a stack
 * trace through `CliProvider` internals tells the user nothing about their
 * typo, and "Alepha failed to start" reads as a crash when the right answer is
 * a usage message.
 *
 * `CliProvider` catches this and renders message + help + exit code 1, the same
 * shape the unknown-command path already used.
 */
export class UsageError extends CommandError {
  name = "UsageError";
}
