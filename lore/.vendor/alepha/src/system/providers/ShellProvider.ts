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
   * Kill the command and reject when it runs longer than this many
   * milliseconds. Without it, a hung `ssh` or a wedged build waits forever.
   */
  timeout?: number;

  /**
   * Abort the command from the outside. When the signal fires, the child is
   * killed and the call rejects.
   */
  signal?: AbortSignal;

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
 * The full outcome of a shell command, as returned by
 * {@link ShellProvider.capture}.
 */
export interface ShellCommandResult {
  /**
   * Everything the command wrote to stdout.
   */
  stdout: string;

  /**
   * Everything the command wrote to stderr.
   */
  stderr: string;

  /**
   * The command's exit code. 0 means success.
   */
  exitCode: number;
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
 *
 *     // Inspect the exit code instead of catching
 *     const result = await this.shell.capture(["git", "diff", "--quiet"]);
 *     if (result.exitCode !== 0) { ... }
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
   * Run a command and return its full outcome instead of throwing.
   *
   * Unlike {@link run}, a non-zero exit RESOLVES — with stdout, stderr and
   * the exit code — so callers that treat the code as data (`git diff
   * --quiet`, health probes) don't have to fish it out of a thrown error.
   * It still rejects when the command cannot run at all (executable not
   * found), times out, or is aborted.
   *
   * Accepts the same command forms and options as {@link run}; `capture`
   * is implied.
   *
   * @param command - The command to run
   * @param options - Execution options
   */
  abstract capture(
    command: string | string[],
    options?: ShellRunOptions,
  ): Promise<ShellCommandResult>;

  /**
   * Check if a command is installed and available in the system PATH.
   *
   * @param command - The command name to check
   * @returns true if the command is available
   */
  abstract isInstalled(command: string): Promise<boolean>;
}
