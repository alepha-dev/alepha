import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $logger } from "@alepha/logger";

/**
 * Service for running external processes with logging support.
 *
 * This service wraps Node.js child_process functionality and provides:
 * - Automatic logging of executed commands
 * - Promise-based execution
 * - Inherited stdio for seamless output
 * - Working directory context
 * - Config file management in node_modules/.alepha
 */
export class ProcessRunner {
  protected readonly log = $logger();

  /**
   * Execute a command using npx with inherited stdio.
   *
   * @param command - The command to execute (will be passed to npx)
   * @param env - Optional environment variables to set for the command
   * @returns Promise that resolves when the process exits
   *
   * @example
   * ```ts
   * const runner = alepha.inject(ProcessRunner);
   * await runner.exec("tsx watch src/index.ts");
   * ```
   */
  public async exec(
    command: string,
    env: Record<string, string> = {},
  ): Promise<void> {
    this.log.debug(`Executing command: npx ${command}`, { cwd: process.cwd() });

    const prog = spawn("npx", command.split(" "), {
      stdio: "inherit",
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env,
      },
    });

    await new Promise<void>((resolve) =>
      prog.on("exit", () => {
        resolve();
      }),
    );
  }

  /**
   * Write a configuration file to node_modules/.alepha directory.
   *
   * Creates the .alepha directory if it doesn't exist and writes the file with the given content.
   *
   * @param name - The name of the config file to create
   * @param content - The content to write to the file
   * @param root - The root directory (defaults to process.cwd())
   * @returns The absolute path to the created file
   *
   * @example
   * ```ts
   * const runner = alepha.inject(ProcessRunner);
   * const configPath = await runner.writeConfigFile("biome.json", biomeConfig);
   * ```
   */
  public async writeConfigFile(
    name: string,
    content: string,
    root = process.cwd(),
  ): Promise<string> {
    const dir = join(root, "node_modules", ".alepha");

    await mkdir(dir, {
      recursive: true,
    }).catch(() => null);

    const path = join(dir, name);
    await writeFile(path, content);

    this.log.debug(`Config file written: ${path}`);

    return path;
  }
}
