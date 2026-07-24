import { AlephaError } from "alepha";
import type { ShellProvider, ShellRunOptions } from "./ShellProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export interface MemoryShellCall {
  /**
   * The command as a display string. Argv-array calls are recorded as their
   * space-joined form so `wasCalled` assertions work for both call styles.
   */
  command: string;

  /**
   * The original argv array, when the call used the array form.
   */
  argv?: string[];

  options: ShellRunOptions;
}

export interface MemoryShellProviderOptions {
  /**
   * Simulated outputs for specific commands.
   * Key is the command string, value is the stdout to return.
   */
  outputs?: Record<string, string>;

  /**
   * Commands that should throw an error.
   * Key is the command string, value is the error message.
   */
  errors?: Record<string, string>;

  /**
   * Commands that are considered "installed" in the system PATH.
   */
  installedCommands?: string[];
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * In-memory implementation of ShellProvider for testing.
 *
 * Records all commands that would be executed without actually running them.
 * Can be configured to return specific outputs or throw errors for testing.
 *
 * @example
 * ```typescript
 * // In tests, substitute the real ShellProvider with MemoryShellProvider
 * const alepha = Alepha.create().with({
 *   provide: ShellProvider,
 *   use: MemoryShellProvider,
 * });
 *
 * // Configure mock behavior
 * const shell = alepha.inject(MemoryShellProvider);
 * shell.configure({
 *   outputs: { "echo hello": "hello\n" },
 *   errors: { "failing-cmd": "Command failed" },
 * });
 *
 * // Or use the fluent API
 * shell.outputs.set("another-cmd", "output");
 * shell.errors.set("another-error", "Error message");
 *
 * // Run code that uses ShellProvider
 * const service = alepha.inject(MyService);
 * await service.doSomething();
 *
 * // Verify commands were called
 * expect(shell.calls).toHaveLength(2);
 * expect(shell.calls[0].command).toBe("yarn install");
 * ```
 */
export class MemoryShellProvider implements ShellProvider {
  /**
   * All recorded shell calls.
   */
  public calls: MemoryShellCall[] = [];

  /**
   * Simulated outputs for specific commands.
   */
  public outputs = new Map<string, string>();

  /**
   * Commands that should throw an error.
   */
  public errors = new Map<string, string>();

  /**
   * Commands considered installed in the system PATH.
   */
  public installedCommands = new Set<string>();

  /**
   * Configure the mock with predefined outputs, errors, and installed commands.
   */
  public configure(options: MemoryShellProviderOptions): this {
    if (options.outputs) {
      for (const [cmd, output] of Object.entries(options.outputs)) {
        this.outputs.set(cmd, output);
      }
    }
    if (options.errors) {
      for (const [cmd, error] of Object.entries(options.errors)) {
        this.errors.set(cmd, error);
      }
    }
    if (options.installedCommands) {
      for (const cmd of options.installedCommands) {
        this.installedCommands.add(cmd);
      }
    }
    return this;
  }

  /**
   * Record command and return simulated output.
   */
  public async run(
    command: string | string[],
    options: ShellRunOptions = {},
  ): Promise<string> {
    const key = Array.isArray(command) ? command.join(" ") : command;
    this.calls.push({
      command: key,
      argv: Array.isArray(command) ? command : undefined,
      options,
    });

    // Check for configured error
    const errorMsg = this.errors.get(key);
    if (errorMsg) {
      throw new AlephaError(errorMsg);
    }

    // Return configured output or empty string
    return this.outputs.get(key) ?? "";
  }

  /**
   * Check if a specific command was called.
   */
  public wasCalled(command: string): boolean {
    return this.calls.some((call) => call.command === command);
  }

  /**
   * Check if a command matching a pattern was called.
   */
  public wasCalledMatching(pattern: RegExp): boolean {
    return this.calls.some((call) => pattern.test(call.command));
  }

  /**
   * Get all calls matching a pattern.
   */
  public getCallsMatching(pattern: RegExp): MemoryShellCall[] {
    return this.calls.filter((call) => pattern.test(call.command));
  }

  /**
   * Check if a command is installed.
   */
  public async isInstalled(command: string): Promise<boolean> {
    return this.installedCommands.has(command);
  }

  /**
   * Reset all recorded state.
   */
  public reset(): void {
    this.calls = [];
    this.outputs.clear();
    this.errors.clear();
    this.installedCommands.clear();
  }
}
