import { $inject, type Alepha } from "alepha";
import { EnvUtils } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";
import {
  type AppEntry,
  AppEntryProvider,
} from "../providers/AppEntryProvider.ts";
import { ViteUtils } from "./ViteUtils.ts";

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
  protected readonly viteUtils = $inject(ViteUtils);

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

  public async loadAlephaFromServerEntryFile(
    opts: {
      mode: "production" | "development";
    } & ({ entry: AppEntry } | { root: string }),
  ): Promise<Alepha> {
    let entry: AppEntry;
    if ("root" in opts) {
      entry = await this.boot.getAppEntry(opts.root);
    } else {
      entry = opts.entry;
    }

    return await this.viteUtils.runAlepha({
      entry,
      mode: opts.mode,
    });
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

  /**
   * Get the current git revision (commit SHA).
   *
   * @returns The short commit SHA or "unknown" if not in a git repo
   */
  public async getGitRevision(): Promise<string> {
    try {
      const result = await this.shell.run("git rev-parse --short HEAD", {
        capture: true,
      });
      return result.trim();
    } catch {
      return "unknown";
    }
  }
}
