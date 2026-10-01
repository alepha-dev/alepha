import { AlephaError } from "alepha";

export interface CommandErrorOptions extends ErrorOptions {
  /**
   * The process exit code this failure should end with. `CliProvider` reads
   * it when it reports the failure; absent, the exit code is 1.
   *
   * | Code | Meaning |
   * | --- | --- |
   * | 0 | success |
   * | 1 | generic failure |
   * | 2 | reserved: `alepha i18n check` found drift |
   * | 3 | not authenticated, or the credential was not accepted |
   * | 4 | forbidden |
   */
  exitCode?: number;
}

export class CommandError extends AlephaError {
  // Not `readonly`: that infers the literal type `"CommandError"` and a
  // subclass can then never narrow it. `UsageError` needs its own name, and
  // `AlephaError` already declares this field the same way.
  name = "CommandError";

  /**
   * The exit code the CLI ends with when this error reaches it, so a script
   * can branch on why a command failed without parsing its English.
   */
  public readonly exitCode?: number;

  constructor(message?: string, options?: CommandErrorOptions) {
    super(message, options);
    this.exitCode = options?.exitCode;
  }
}
