import { type ExecException, exec, execFile, spawn } from "node:child_process";
import { join } from "node:path";

import { $inject, AlephaError } from "alepha";
import { $logger } from "alepha/logger";

import { FileSystemProvider } from "./FileSystemProvider.ts";
import type {
  ShellCommandResult,
  ShellProvider,
  ShellRunOptions,
} from "./ShellProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Node.js implementation of ShellProvider.
 *
 * Executes shell commands using Node.js child_process module.
 * Supports binary resolution from node_modules/.bin for local packages.
 */
export class NodeShellProvider implements ShellProvider {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * Run a shell command or binary.
   */
  public async run(
    command: string | string[],
    options: ShellRunOptions = {},
  ): Promise<string> {
    const { resolve = false, capture = false, root, stdin } = options;
    const cwd = root ?? process.cwd();
    const isArgv = Array.isArray(command);

    this.log.debug(`Shell: ${isArgv ? command.join(" ") : command}`, {
      cwd,
      resolve,
      capture,
    });

    let executable: string;
    let args: string[];

    if (isArgv) {
      if (command.length === 0) {
        throw new AlephaError("Cannot run an empty argv array");
      }
      [executable, ...args] = command;
      if (resolve) {
        executable = await this.resolveExecutable(executable, cwd);
      }
      if (capture) {
        // Argv form never touches a shell — args are passed verbatim.
        return this.throwOnFailure(
          await this.argvResult(executable, args, { ...options, cwd }),
        );
      }
      return this.execInherit(executable, args, { ...options, cwd });
    }

    if (stdin !== undefined) {
      throw new AlephaError(
        'stdin requires the argv-array form: run(["cmd", "arg"], { stdin }). ' +
          "The string form is parsed and re-quoted for a shell, so there is no " +
          "pipe to attach — dropping the data quietly would be worse.",
      );
    }

    if (resolve) {
      const [bin, ...rest] = this.parseCommand(command);
      executable = await this.resolveExecutable(bin, cwd);
      args = rest;
    } else {
      [executable, ...args] = this.parseCommand(command);
    }

    if (capture) {
      return this.throwOnFailure(
        await this.shellResult(executable, args, { ...options, cwd }),
      );
    }

    return this.execInherit(executable, args, { ...options, cwd });
  }

  /**
   * Run a command and return its full outcome instead of throwing on a
   * non-zero exit.
   */
  public async capture(
    command: string | string[],
    options: ShellRunOptions = {},
  ): Promise<ShellCommandResult> {
    const { resolve = false, root, stdin } = options;
    const cwd = root ?? process.cwd();

    if (Array.isArray(command)) {
      if (command.length === 0) {
        throw new AlephaError("Cannot run an empty argv array");
      }
      let [executable, ...args] = command;
      if (resolve) {
        executable = await this.resolveExecutable(executable, cwd);
      }
      return this.argvResult(executable, args, { ...options, cwd });
    }

    if (stdin !== undefined) {
      throw new AlephaError(
        'stdin requires the argv-array form: capture(["cmd", "arg"], { stdin }).',
      );
    }

    let [executable, ...args] = this.parseCommand(command);
    if (resolve) {
      executable = await this.resolveExecutable(executable, cwd);
    }
    return this.shellResult(executable, args, { ...options, cwd });
  }

  /**
   * Normalises the `stdin` option to bytes.
   *
   * A string is encoded as UTF-8; a `Uint8Array` is passed through untouched,
   * which is what lets a gzip artifact survive the trip.
   */
  protected toStdinBytes(stdin: Uint8Array | string): Uint8Array {
    return typeof stdin === "string" ? new TextEncoder().encode(stdin) : stdin;
  }

  /**
   * Writes the bytes and closes the stream.
   *
   * Closing is the load-bearing half: a child reading to EOF — `ssh` feeding a
   * request body, `bay deploy -` copying to a temp file — never finishes
   * without it, and the symptom is a deploy that hangs rather than fails.
   *
   * EPIPE is swallowed on purpose: a command that exits before reading all its
   * input has not failed *here*, and the exit code below is the real verdict.
   */
  protected writeStdin(
    proc: { stdin: NodeJS.WritableStream | null },
    stdin: Uint8Array | string,
  ): void {
    if (!proc.stdin) {
      return;
    }
    proc.stdin.on("error", () => {});
    proc.stdin.write(this.toStdinBytes(stdin));
    proc.stdin.end();
  }

  /**
   * Execute command with inherited stdio (streams to terminal).
   */
  protected async execInherit(
    executable: string,
    args: string[],
    options: ShellRunOptions & { cwd: string },
  ): Promise<string> {
    const isWindows = process.platform === "win32";
    // Only stdin changes: stdout and stderr keep going straight to the
    // terminal, which is the whole reason a caller chose this path.
    const stdio: Array<"pipe" | "inherit"> =
      options.stdin === undefined
        ? ["inherit", "inherit", "inherit"]
        : ["pipe", "inherit", "inherit"];

    // On Windows, use shell mode with a single command string to avoid
    // Node.js DEP0190 deprecation warning about unescaped args with shell: true
    const proc = isWindows
      ? spawn(this.buildShellCommand(executable, args), [], {
          stdio,
          cwd: options.cwd,
          shell: true,
          env: {
            ...process.env,
            PATH: this.localBinPath(options.cwd),
            ...options.env,
          },
        })
      : spawn(executable, args, {
          stdio,
          cwd: options.cwd,
          env: {
            ...process.env,
            PATH: this.localBinPath(options.cwd),
            ...options.env,
          },
        });

    if (options.stdin !== undefined) {
      this.writeStdin(proc, options.stdin);
    }

    return new Promise<string>((resolve, reject) => {
      let timedOut = false;
      let aborted = false;

      const timer = options.timeout
        ? setTimeout(() => {
            timedOut = true;
            proc.kill("SIGTERM");
          }, options.timeout)
        : undefined;

      const onAbort = () => {
        aborted = true;
        proc.kill("SIGTERM");
      };
      if (options.signal?.aborted) {
        onAbort();
      } else {
        options.signal?.addEventListener("abort", onAbort, { once: true });
      }

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      };

      proc.on("exit", (code, signal) => {
        cleanup();
        if (timedOut) {
          reject(
            new AlephaError(`Command timed out after ${options.timeout}ms`),
          );
        } else if (aborted) {
          reject(new AlephaError("Command aborted"));
        } else if (signal != null) {
          // `code` is null when the child was killed by a signal — that is a
          // failure (SIGKILL, SIGSEGV, OOM), not a success.
          reject(new AlephaError(`Command killed by signal ${signal}`));
        } else if (code === 0 || code === null) {
          resolve("");
        } else {
          reject(new AlephaError(`Command exited with code ${code}`));
        }
      });
      proc.on("error", (err) => {
        cleanup();
        reject(err);
      });
    });
  }

  /**
   * Build a shell command string where every argument stays literal.
   *
   * POSIX: single-quote escaping (`'...'` with `'\''` for embedded quotes) —
   * nothing expands inside single quotes, so `;`, backticks, `$(...)`, `|`
   * and friends cannot break out of an argument.
   * Windows (cmd.exe): double-quote escaping.
   */
  protected buildShellCommand(executable: string, args: string[]): string {
    const isWindows = process.platform === "win32";

    const escapeForShell = isWindows
      ? (str: string): string => {
          if (/[\s"&|<>^()]/.test(str)) {
            return `"${str.replace(/"/g, '\\"')}"`;
          }
          return str;
        }
      : (str: string): string => {
          if (/^[\w./:=@%,+-]+$/.test(str)) {
            return str;
          }
          return `'${str.replaceAll("'", `'\\''`)}'`;
        };

    return [escapeForShell(executable), ...args.map(escapeForShell)].join(" ");
  }

  /**
   * String-form capture engine: a real shell consumes the escaping built by
   * {@link buildShellCommand}.
   *
   * This is the override point for runtimes with their own spawner (Bun) —
   * they receive the PARSED argv, never the escaped string, so they cannot
   * corrupt it by re-parsing.
   */
  protected shellResult(
    executable: string,
    args: string[],
    options: ShellRunOptions & { cwd: string },
  ): Promise<ShellCommandResult> {
    return new Promise<ShellCommandResult>((resolve, reject) => {
      exec(
        this.buildShellCommand(executable, args),
        {
          cwd: options.cwd,
          maxBuffer: 50 * 1024 * 1024,
          timeout: options.timeout,
          signal: options.signal,
          env: this.captureEnv(options),
        },
        (err, stdout, stderr) => {
          this.settleExecResult(err, stdout, stderr, options, resolve, reject);
        },
      );
    });
  }

  /**
   * Argv-form capture engine — no shell involved.
   */
  protected argvResult(
    executable: string,
    args: string[],
    options: ShellRunOptions & { cwd: string },
  ): Promise<ShellCommandResult> {
    return new Promise<ShellCommandResult>((resolve, reject) => {
      const proc = execFile(
        executable,
        args,
        {
          cwd: options.cwd,
          maxBuffer: 50 * 1024 * 1024,
          timeout: options.timeout,
          signal: options.signal,
          env: this.captureEnv(options),
        },
        (err, stdout, stderr) => {
          this.settleExecResult(err, stdout, stderr, options, resolve, reject);
        },
      );

      if (options.stdin !== undefined) {
        this.writeStdin(proc, options.stdin);
      }
    });
  }

  /**
   * Child environment for capture paths.
   *
   * `LOG_FORMAT=pretty` keeps captured Alepha subcommand output readable;
   * the caller's `env` can still override it.
   */
  protected captureEnv(
    options: ShellRunOptions & { cwd: string },
  ): NodeJS.ProcessEnv {
    return {
      ...process.env,
      PATH: this.localBinPath(options.cwd),
      LOG_FORMAT: "pretty",
      ...options.env,
    };
  }

  /**
   * Maps an exec/execFile callback outcome onto the capture contract:
   * an exit code — any exit code — RESOLVES; only "the command never ran to
   * completion on its own terms" (not found, timed out, aborted, signalled)
   * rejects.
   */
  protected settleExecResult(
    err: ExecException | null,
    stdout: string,
    stderr: string,
    options: ShellRunOptions,
    resolve: (result: ShellCommandResult) => void,
    reject: (error: Error) => void,
  ): void {
    if (!err) {
      resolve({ stdout, stderr, exitCode: 0 });
      return;
    }

    if (options.signal?.aborted || err.name === "AbortError") {
      reject(new AlephaError("Command aborted"));
      return;
    }

    if (options.timeout && (err as { killed?: boolean }).killed) {
      reject(new AlephaError(`Command timed out after ${options.timeout}ms`));
      return;
    }

    if (typeof err.code === "number") {
      resolve({ stdout, stderr, exitCode: err.code });
      return;
    }

    if (err.signal) {
      reject(new AlephaError(`Command killed by signal ${err.signal}`));
      return;
    }

    // Spawn-level failure (ENOENT, EACCES, maxBuffer...): attach both streams
    // so callers (e.g. the CLI Runner) can surface the full output.
    const wrapped = new AlephaError(`Command failed: ${err.message}`, {
      cause: err,
    });
    (wrapped as any).stdout = stdout;
    (wrapped as any).stderr = stderr;
    reject(wrapped);
  }

  /**
   * Converts a capture result into `run()`'s throwing contract: non-zero
   * exit throws, with both streams attached for the caller to surface.
   */
  protected throwOnFailure(result: ShellCommandResult): string {
    if (result.exitCode !== 0) {
      const err = new AlephaError(
        `Command exited with code ${result.exitCode}: ${
          result.stderr || result.stdout
        }`,
      );
      (err as any).stdout = result.stdout;
      (err as any).stderr = result.stderr;
      throw err;
    }
    return result.stdout;
  }

  /**
   * Resolve executable path from node_modules/.bin.
   *
   * Search order:
   * 1. Local: node_modules/.bin/
   * 2. Pnpm nested: node_modules/alepha/node_modules/.bin/
   * 3. Monorepo: Walk up to 3 parent directories
   */
  protected async resolveExecutable(
    name: string,
    root: string,
  ): Promise<string> {
    const isWindows = process.platform === "win32";
    // On Windows, try .cmd first (npm scripts), then .exe, then no extension
    const suffixes = isWindows ? [".cmd", ".exe", ""] : [""];

    for (const suffix of suffixes) {
      // 1. Local node_modules
      let execPath = await this.findExecutable(
        root,
        `node_modules/.bin/${name}${suffix}`,
      );
      if (execPath) return execPath;

      // 2. Pnpm nested (alepha's own node_modules)
      execPath = await this.findExecutable(
        root,
        `node_modules/alepha/node_modules/.bin/${name}${suffix}`,
      );
      if (execPath) return execPath;

      // 3. Monorepo: check parent directories (up to 3 levels)
      let parentDir = this.fs.join(root, "..");
      for (let i = 0; i < 3; i++) {
        execPath = await this.findExecutable(
          parentDir,
          `node_modules/.bin/${name}${suffix}`,
        );
        if (execPath) return execPath;
        parentDir = this.fs.join(parentDir, "..");
      }
    }

    throw new AlephaError(
      `Could not find executable for '${name}'. Make sure the package is installed.`,
    );
  }

  /**
   * The same directories {@link resolveExecutable} searches, as a PATH prefix
   * for child processes.
   *
   * npm and yarn both do this for the scripts they run, and a command shelled
   * out from a task expects the same thing: `alepha`, `vite` or `tsc` should
   * mean the project's copy. Without it the child inherits a bare PATH and any
   * globally installed binary of the same name wins.
   *
   * That is not hypothetical. `alepha verify` shells `alepha clean`, and on a
   * machine with a global `alepha` the child was a different install
   * altogether — which surfaced as `MissingContextError: Did you forget to call
   * Alepha.create()?`, naming neither the PATH nor the binary that actually
   * ran.
   *
   * Note this changes LOOKUP only. Every token of the command is still a
   * literal argument — shell operators like `&&` do not compose here (see
   * `shellStringContract.spec.ts`); callers that want a pipeline must ask
   * for a shell explicitly (`["sh", "-c", "a | b"]`).
   */
  protected localBinPath(root: string): string {
    const separator = process.platform === "win32" ? ";" : ":";
    // `node:path`, not the injected `FileSystemProvider`: this runs on every
    // single shell call, and it is pure string math that touches no disk.
    // Going through the provider made `fs` a hard requirement of the plain
    // `run()` path, where it had only ever been needed under `resolve: true`.
    const dirs = [
      join(root, "node_modules/.bin"),
      join(root, "node_modules/alepha/node_modules/.bin"),
    ];

    let parentDir = join(root, "..");
    for (let i = 0; i < 3; i++) {
      dirs.push(join(parentDir, "node_modules/.bin"));
      parentDir = join(parentDir, "..");
    }

    // Existence is not checked: this runs on every shell call, a missing entry
    // in PATH is harmless, and the directory may be created between this call
    // and the child's lookup.
    return [...dirs, process.env.PATH ?? ""].join(separator);
  }

  /**
   * Check if executable exists at path.
   */
  protected async findExecutable(
    root: string,
    relativePath: string,
  ): Promise<string | undefined> {
    const fullPath = this.fs.join(root, relativePath);
    if (await this.fs.exists(fullPath)) {
      return fullPath;
    }
    return undefined;
  }

  /**
   * Check if a command is installed and available in the system PATH.
   */
  public isInstalled(command: string): Promise<boolean> {
    // The name is interpolated into a shell string below — refuse anything
    // that isn't a plain command name rather than letting metacharacters run.
    if (!/^[\w.-]+$/.test(command)) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      const check =
        process.platform === "win32"
          ? `where ${command}`
          : `command -v ${command}`;
      exec(check, (error) => resolve(!error));
    });
  }

  /**
   * Parse a command string into executable and arguments.
   *
   * Handles quoted arguments properly for paths with spaces.
   * Supports both single and double quotes.
   */
  protected parseCommand(command: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuote: string | null = null;

    for (let i = 0; i < command.length; i++) {
      const char = command[i];

      if (inQuote) {
        if (char === inQuote) {
          inQuote = null;
        } else {
          current += char;
        }
      } else if (char === '"' || char === "'") {
        inQuote = char;
      } else if (char === " ") {
        if (current) {
          result.push(current);
          current = "";
        }
      } else {
        current += char;
      }
    }

    if (current) {
      result.push(current);
    }

    return result;
  }
}
