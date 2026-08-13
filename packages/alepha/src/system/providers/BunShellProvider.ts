import { AlephaError } from "alepha";
import { NodeShellProvider } from "./NodeShellProvider.ts";
import type { ShellCommandResult, ShellRunOptions } from "./ShellProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Bun implementation of ShellProvider.
 *
 * Executes shell commands using Bun's native `Bun.spawn` and `Bun.which`,
 * skipping the `node:child_process` compatibility layer for better performance.
 *
 * Inherits executable resolution (`node_modules/.bin` walk) and command parsing
 * from `NodeShellProvider`. Both capture engines receive PARSED argv (never an
 * escaped shell string), so quoting survives intact.
 */
export class BunShellProvider extends NodeShellProvider {
  /**
   * Execute command with inherited stdio (streams to terminal).
   */
  protected override async execInherit(
    executable: string,
    args: string[],
    options: ShellRunOptions & { cwd: string },
  ): Promise<string> {
    const proc = Bun.spawn([executable, ...args], {
      cwd: options.cwd,
      env: {
        ...process.env,
        // Same PATH prefix as the node engine — without it, a globally
        // installed binary shadows the project's own copy on Bun only.
        PATH: this.localBinPath(options.cwd),
        ...options.env,
      },
      stdout: "inherit",
      stderr: "inherit",
      // `Bun.spawn` takes a TypedArray directly and closes the stream itself,
      // so there is no equivalent of the write-then-end dance above.
      stdin:
        options.stdin === undefined
          ? "inherit"
          : this.toStdinBytes(options.stdin),
    });

    const { timedOut, aborted, cleanup } = this.armKillSwitches(proc, options);
    const code = await proc.exited;
    cleanup();

    if (timedOut()) {
      throw new AlephaError(`Command timed out after ${options.timeout}ms`);
    }
    if (aborted()) {
      throw new AlephaError("Command aborted");
    }
    if (code !== 0) {
      throw new AlephaError(`Command exited with code ${code}`);
    }
    return "";
  }

  /**
   * Both capture engines route through `Bun.spawn` with plain argv.
   */
  protected override shellResult(
    executable: string,
    args: string[],
    options: ShellRunOptions & { cwd: string },
  ): Promise<ShellCommandResult> {
    return this.bunResult(executable, args, options);
  }

  protected override argvResult(
    executable: string,
    args: string[],
    options: ShellRunOptions & { cwd: string },
  ): Promise<ShellCommandResult> {
    return this.bunResult(executable, args, options);
  }

  /**
   * Capture engine: spawn, collect both streams, report the exit code.
   */
  protected async bunResult(
    executable: string,
    args: string[],
    options: ShellRunOptions & { cwd: string },
  ): Promise<ShellCommandResult> {
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn([executable, ...args], {
        cwd: options.cwd,
        env: this.captureEnv(options),
        stdout: "pipe",
        stderr: "pipe",
        stdin:
          options.stdin === undefined
            ? undefined
            : this.toStdinBytes(options.stdin),
      });
    } catch (cause) {
      throw new AlephaError(`Command failed: ${executable}`, { cause });
    }

    const { timedOut, aborted, cleanup } = this.armKillSwitches(proc, options);

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
    cleanup();

    if (timedOut()) {
      throw new AlephaError(`Command timed out after ${options.timeout}ms`);
    }
    if (aborted()) {
      throw new AlephaError("Command aborted");
    }

    return { stdout, stderr, exitCode };
  }

  /**
   * Arms the timeout timer and abort listener over a spawned process.
   *
   * Returns flag readers (the promise settles AFTER the kill fires, so the
   * caller checks the flags once the process has exited) and a cleanup that
   * must run exactly once.
   */
  protected armKillSwitches(
    proc: { kill: (signal?: number | NodeJS.Signals) => void },
    options: ShellRunOptions,
  ): { timedOut: () => boolean; aborted: () => boolean; cleanup: () => void } {
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

    return {
      timedOut: () => timedOut,
      aborted: () => aborted,
      cleanup: () => {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      },
    };
  }

  /**
   * Check if a command is installed and available in the system PATH.
   */
  public override async isInstalled(command: string): Promise<boolean> {
    return Bun.which(command) !== null;
  }
}
