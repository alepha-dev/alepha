// ---------------------------------------------------------------------------------------------------------------------

export interface ShellRunOptions {
  /**
   * Working directory for the command.
   */
  root?: string;

  /**
   * Additional environment variables.
   */
  env?: Record<string, string>;

  /**
   * Resolve the executable from node_modules/.bin.
   * Supports local project, pnpm nested, and monorepo structures.
   * @default false
   */
  resolve?: boolean;

  /**
   * Capture stdout instead of inheriting stdio.
   * When true, returns stdout as string.
   * When false, streams output to terminal.
   * @default false
   */
  capture?: boolean;

  /**
   * Bytes to write to the command's stdin, after which the stream is closed.
   *
   * **Argv-array commands only.** The string form is parsed and re-quoted for
   * a shell, so there is no child to attach a pipe to — passing this with a
   * string command throws rather than silently dropping the data.
   *
   * Buffered, not streamed: the caller hands over a value it already holds.
   * That is the right trade for what this exists for — piping a ~10 MB deploy
   * artifact into `ssh` — and a streaming API can be added the day something
   * needs one.
   */
  stdin?: Uint8Array | string;
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Abstract provider for executing shell commands and binaries.
 *
 * Implementations:
 * - `NodeShellProvider` - Real shell execution using Node.js child_process
 * - `MemoryShellProvider` - In-memory mock for testing
 *
 * @example
 * ```typescript
 * class MyService {
 *   protected readonly shell = $inject(ShellProvider);
 *
 *   async build() {
 *     // Run shell command directly
 *     await this.shell.run("yarn install");
 *
 *     // Run local binary with resolution
 *     await this.shell.run("vite build", { resolve: true });
 *
 *     // Capture output
 *     const output = await this.shell.run("echo hello", { capture: true });
 *   }
 * }
 * ```
 */
export abstract class ShellProvider {
  /**
   * Run a shell command or binary.
   *
   * The command can be either:
   * - a string (`"git status"`), parsed on whitespace with quote support;
   * - an argv array (`["git", "log", ref]`), passed to the process verbatim
   *   with NO shell and NO parsing.
   *
   * Always use the argv-array form when any part of the command comes from
   * a variable (paths, user input, refs, keys...) — it is injection-proof by
   * construction.
   *
   * @param command - The command to run
   * @param options - Execution options
   * @returns stdout if capture is true, empty string otherwise
   */
  abstract run(
    command: string | string[],
    options?: ShellRunOptions,
  ): Promise<string>;

  /**
   * Check if a command is installed and available in the system PATH.
   *
   * @param command - The command name to check
   * @returns true if the command is available
   */
  abstract isInstalled(command: string): Promise<boolean>;
}
