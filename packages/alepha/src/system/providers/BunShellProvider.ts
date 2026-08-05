import { AlephaError } from "alepha";
import { NodeShellProvider } from "./NodeShellProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Bun implementation of ShellProvider.
 *
 * Executes shell commands using Bun's native `Bun.spawn` and `Bun.which`,
 * skipping the `node:child_process` compatibility layer for better performance.
 *
 * Inherits executable resolution (`node_modules/.bin` walk) and command parsing
 * from `NodeShellProvider`.
 */
export class BunShellProvider extends NodeShellProvider {
  /**
   * Execute command with inherited stdio (streams to terminal).
   */
  protected override async execInherit(
    executable: string,
    args: string[],
    options: {
      cwd: string;
      env?: Record<string, string>;
      stdin?: Uint8Array | string;
    },
  ): Promise<string> {
    const proc = Bun.spawn([executable, ...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdout: "inherit",
      stderr: "inherit",
      // `Bun.spawn` takes a TypedArray directly and closes the stream itself,
      // so there is no equivalent of the write-then-end dance above.
      stdin:
        options.stdin === undefined
          ? "inherit"
          : this.toStdinBytes(options.stdin),
    });

    const code = await proc.exited;
    if (code !== 0) {
      throw new AlephaError(`Command exited with code ${code}`);
    }
    return "";
  }

  /**
   * Execute command and capture stdout.
   */
  protected override async execCapture(
    command: string,
    options: { cwd: string; env?: Record<string, string> },
  ): Promise<string> {
    const [executable, ...args] = this.parseCommand(command);
    const proc = Bun.spawn([executable, ...args], {
      cwd: options.cwd,
      env: {
        ...process.env,
        LOG_FORMAT: "pretty",
        ...options.env,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (code !== 0) {
      const err = new AlephaError(
        `Command exited with code ${code}: ${stderr || stdout}`,
      );
      (err as any).stdout = stdout;
      (err as any).stderr = stderr;
      throw err;
    }
    return stdout;
  }

  /**
   * Check if a command is installed and available in the system PATH.
   */
  public override async isInstalled(command: string): Promise<boolean> {
    return Bun.which(command) !== null;
  }
}
