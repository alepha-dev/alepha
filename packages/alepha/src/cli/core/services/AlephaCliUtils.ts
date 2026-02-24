import { $inject, Alepha } from "alepha";
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
  protected readonly alepha = $inject(Alepha);

  // ===========================================
  // Command Execution
  // ===========================================

  /**
   * Execute a command with inherited stdio.
   */
  public async exec(
    command: string,
    options: {
      root?: string;
      env?: Record<string, string>;
      global?: boolean;
      capture?: boolean;
    } = {},
  ): Promise<void> {
    await this.shell.run(command, {
      root: options.root,
      env: options.env,
      resolve: !options.global,
      capture: options.capture,
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

  /**
   * Get the user's email from git config.
   *
   * @returns The git user email or undefined if not configured
   */
  public async getGitEmail(): Promise<string | undefined> {
    try {
      const result = await this.shell.run("git config user.email", {
        capture: true,
      });
      const email = result.trim();
      return email || undefined;
    } catch {
      return undefined;
    }
  }
}
