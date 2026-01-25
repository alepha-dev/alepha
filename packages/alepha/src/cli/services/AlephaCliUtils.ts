import { $inject, Alepha, AlephaError } from "alepha";
import { EnvUtils } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";
import { AppEntryProvider } from "../providers/AppEntryProvider.ts";

/**
 * Core utility service for CLI commands.
 *
 * Provides:
 * - Command execution
 * - File editing helpers
 * - Drizzle/ORM utilities
 * - Environment loading
 */
export class AlephaCliUtils {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly envUtils = $inject(EnvUtils);
  protected readonly boot = $inject(AppEntryProvider);
  protected readonly shell = $inject(ShellProvider);

  // ===========================================
  // Command Execution
  // ===========================================

  /**
   * Execute a command with inherited stdio.
   *
   * @param command - The command to execute
   * @param options.root - Working directory
   * @param options.env - Additional environment variables
   * @param options.global - If true, run command directly without resolving from node_modules
   */
  public async exec(
    command: string,
    options: {
      root?: string;
      env?: Record<string, string>;
      global?: boolean;
    } = {},
  ): Promise<void> {
    await this.shell.run(command, {
      root: options.root,
      env: options.env,
      resolve: !options.global,
      capture: false,
    });
  }

  /**
   * Write a configuration file to node_modules/.alepha directory.
   */
  public async writeConfigFile(
    name: string,
    content: string,
    root = process.cwd(),
  ): Promise<string> {
    const dir = this.fs.join(root, "node_modules", ".alepha");

    await this.fs.mkdir(dir, { recursive: true }).catch(() => null);

    const path = this.fs.join(dir, name);
    await this.fs.writeFile(path, content);

    this.log.debug(`Config file written: ${path}`);

    return path;
  }

  /**
   * Load Alepha instance from a server entry file.
   */
  public async loadAlephaFromServerEntryFile(
    rootDir?: string,
    explicitEntry?: string,
  ): Promise<{
    alepha: Alepha;
    entry: string;
  }> {
    process.env.ALEPHA_CLI_IMPORT = "true";

    const root = rootDir ?? process.cwd();
    let entry: string;

    if (explicitEntry) {
      // Explicit entry provided
      entry = this.fs.join(root, explicitEntry);
      if (!(await this.fs.exists(entry))) {
        throw new AlephaError(
          `Explicit server entry file "${explicitEntry}" not found.`,
        );
      }
    } else {
      // Auto-discover entry
      const appEntry = await this.boot.getAppEntry(root);
      entry = this.fs.join(root, appEntry.server);
    }

    delete (global as any).__alepha;

    const mod = await import(entry);

    this.log.debug(`Load entry: ${entry}`);

    // check if alepha is correctly exported
    if (mod.default instanceof Alepha) {
      return { alepha: mod.default, entry };
    }

    // else, try with global variable
    const g: any = global;
    if (g.__alepha) {
      return { alepha: g.__alepha, entry };
    }

    throw new AlephaError(
      `Could not find Alepha instance in entry file: ${entry}`,
    );
  }

  // ===========================================
  // Drizzle ORM & Kit Utilities
  // ===========================================

  /**
   * Generate JavaScript code for Drizzle entities export.
   */
  public generateEntitiesJs(
    entry: string,
    provider: string,
    models: string[] = [],
  ): string {
    return `
import "${entry}";
import { DrizzleKitProvider, Repository } from "alepha/orm";

const alepha = globalThis.__alepha;
const kit = alepha.inject(DrizzleKitProvider);
const provider = alepha.services(Repository).find((it) => it.provider.name === "${provider}").provider;
const models = kit.getModels(provider);

${models.map((it: string) => `export const ${it} = models["${it}"];`).join("\n")}

`.trim();
  }

  // ===========================================
  // Environment
  // ===========================================

  /**
   * Load environment variables from a .env file.
   */
  public async loadEnv(
    root: string,
    files: string[] = [".env"],
  ): Promise<void> {
    await this.envUtils.loadEnv(root, files);
  }

  // ===========================================
  // Helpers
  // ===========================================

  public async exists(root: string, path: string): Promise<boolean> {
    return this.fs.exists(this.fs.join(root, path));
  }

  /**
   * Check if a command is installed and available in the system PATH.
   */
  public isInstalledAsync(cmd: string): Promise<boolean> {
    return this.shell.isInstalled(cmd);
  }
}
