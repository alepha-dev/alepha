import { exec, execFile, spawn } from "node:child_process";
import { $inject, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "./FileSystemProvider.ts";
import type { ShellProvider, ShellRunOptions } from "./ShellProvider.ts";

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
    const { resolve = false, capture = false, root, env } = options;
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
        return this.execCaptureArgv(executable, args, { cwd, env });
      }
      return this.execInherit(executable, args, { cwd, env });
    }

    if (resolve) {
      const [bin, ...rest] = this.parseCommand(command);
      executable = await this.resolveExecutable(bin, cwd);
      args = rest;
    } else {
      [executable, ...args] = this.parseCommand(command);
    }

    // Build properly escaped command string for shell execution
    const shellCommand = this.buildShellCommand(executable, args);

    if (capture) {
      return this.execCapture(shellCommand, { cwd, env });
    }

    return this.execInherit(executable, args, { cwd, env });
  }

  /**
   * Execute command with inherited stdio (streams to terminal).
   */
  protected async execInherit(
    executable: string,
    args: string[],
    options: { cwd: string; env?: Record<string, string> },
  ): Promise<string> {
    const isWindows = process.platform === "win32";

    // On Windows, use shell mode with a single command string to avoid
    // Node.js DEP0190 deprecation warning about unescaped args with shell: true
    const proc = isWindows
      ? spawn(this.buildShellCommand(executable, args), [], {
          stdio: "inherit",
          cwd: options.cwd,
          shell: true,
          env: { ...process.env, ...options.env },
        })
      : spawn(executable, args, {
          stdio: "inherit",
          cwd: options.cwd,
          env: { ...process.env, ...options.env },
        });

    return new Promise<string>((resolve, reject) => {
      proc.on("exit", (code, signal) => {
        // `code` is null when the child was killed by a signal — that is a
        // failure (SIGKILL, SIGSEGV, OOM), not a success.
        if (signal != null) {
          reject(new AlephaError(`Command killed by signal ${signal}`));
        } else if (code === 0 || code === null) {
          resolve("");
        } else {
          reject(new AlephaError(`Command exited with code ${code}`));
        }
      });
      proc.on("error", reject);
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
   * Execute command and capture stdout.
   */
  protected execCapture(
    command: string,
    options: { cwd: string; env?: Record<string, string> },
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      exec(
        command,
        {
          cwd: options.cwd,
          maxBuffer: 50 * 1024 * 1024,
          env: {
            ...process.env,
            LOG_FORMAT: "pretty",
            ...options.env,
          },
        },
        (err, stdout, stderr) => {
          if (err) {
            // Attach both streams so callers (e.g. the CLI Runner) can surface
            // the full output of a failed command, not just stdout.
            (err as any).stdout = stdout;
            (err as any).stderr = stderr;
            reject(err);
          } else {
            resolve(stdout);
          }
        },
      );
    });
  }

  /**
   * Execute an argv array and capture stdout — no shell involved.
   */
  protected execCaptureArgv(
    executable: string,
    args: string[],
    options: { cwd: string; env?: Record<string, string> },
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      execFile(
        executable,
        args,
        {
          cwd: options.cwd,
          maxBuffer: 50 * 1024 * 1024,
          env: {
            ...process.env,
            LOG_FORMAT: "pretty",
            ...options.env,
          },
        },
        (err, stdout, stderr) => {
          if (err) {
            (err as any).stdout = stdout;
            (err as any).stderr = stderr;
            reject(err);
          } else {
            resolve(stdout);
          }
        },
      );
    });
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
