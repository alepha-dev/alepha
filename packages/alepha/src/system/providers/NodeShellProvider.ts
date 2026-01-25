import { exec, spawn } from "node:child_process";
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
    command: string,
    options: ShellRunOptions = {},
  ): Promise<string> {
    const { resolve = false, capture = false, root, env } = options;
    const cwd = root ?? process.cwd();

    this.log.debug(`Shell: ${command}`, { cwd, resolve, capture });

    let executable: string;
    let args: string[];

    if (resolve) {
      const [bin, ...rest] = command.split(" ");
      executable = await this.resolveExecutable(bin, cwd);
      args = rest;
    } else {
      [executable, ...args] = command.split(" ");
    }

    if (capture) {
      return this.execCapture(command, { cwd, env });
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
    const proc = spawn(executable, args, {
      stdio: "inherit",
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
    });

    return new Promise<string>((resolve, reject) => {
      proc.on("exit", (code) => {
        if (code === 0 || code === null) {
          resolve("");
        } else {
          reject(new AlephaError(`Command exited with code ${code}`));
        }
      });
      proc.on("error", reject);
    });
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
          env: {
            ...process.env,
            LOG_FORMAT: "pretty",
            ...options.env,
          },
        },
        (err, stdout) => {
          if (err) {
            (err as any).stdout = stdout;
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
    const suffix = process.platform === "win32" ? ".cmd" : "";

    // 1. Local node_modules
    let execPath = await this.findExecutable(
      root,
      `node_modules/.bin/${name}${suffix}`,
    );

    // 2. Pnpm nested (alepha's own node_modules)
    if (!execPath) {
      execPath = await this.findExecutable(
        root,
        `node_modules/alepha/node_modules/.bin/${name}${suffix}`,
      );
    }

    // 3. Monorepo: check parent directories (up to 3 levels)
    if (!execPath) {
      let parentDir = this.fs.join(root, "..");
      for (let i = 0; i < 3; i++) {
        execPath = await this.findExecutable(
          parentDir,
          `node_modules/.bin/${name}${suffix}`,
        );
        if (execPath) break;
        parentDir = this.fs.join(parentDir, "..");
      }
    }

    if (!execPath) {
      throw new AlephaError(
        `Could not find executable for '${name}'. Make sure the package is installed.`,
      );
    }

    return execPath;
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
    return new Promise((resolve) => {
      const check =
        process.platform === "win32"
          ? `where ${command}`
          : `command -v ${command}`;
      exec(check, (error) => resolve(!error));
    });
  }
}
