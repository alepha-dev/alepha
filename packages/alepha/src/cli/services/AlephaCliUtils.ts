import { spawn } from "node:child_process";
import { $inject, Alepha, AlephaError } from "alepha";
import { EnvUtils } from "alepha/command";
import { FileSystemProvider } from "alepha/file";
import { $logger } from "alepha/logger";
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
    } = {},
  ): Promise<void> {
    const root = options.root ?? process.cwd();
    this.log.debug(`Executing command: ${command}`, { cwd: root });

    const runExec = async (app: string, args: string[]) => {
      const prog = spawn(app, args, {
        stdio: "inherit",
        cwd: root,
        env: {
          ...process.env,
          ...options.env,
        },
      });

      await new Promise<void>((resolve) =>
        prog.on("exit", () => {
          resolve();
        }),
      );
    };

    if (options.global) {
      const [app, ...args] = command.split(" ");
      await runExec(app, args);
      return;
    }

    const suffix = process.platform === "win32" ? ".cmd" : "";
    const [app, ...args] = command.split(" ");

    // find executable inside project node_modules
    let execPath = await this.checkFileExists(
      root,
      `node_modules/.bin/${app}${suffix}`,
    );

    // or, find executable inside alepha package node_modules (pnpm style)
    if (!execPath) {
      execPath = await this.checkFileExists(
        root,
        `node_modules/alepha/node_modules/.bin/${app}${suffix}`,
      );
    }

    // check if parent folder (monorepo) has the executable (check 3 times)
    if (!execPath) {
      let parentDir = this.fs.join(root, "..");
      for (let i = 0; i < 3; i++) {
        execPath = await this.checkFileExists(
          parentDir,
          `node_modules/.bin/${app}${suffix}`,
        );
        if (execPath) {
          break;
        }
        parentDir = this.fs.join(parentDir, "..");
      }
    }

    if (!execPath) {
      throw new AlephaError(
        `Could not find executable for command '${app}'. Make sure the package is installed.`,
      );
    }

    await runExec(execPath, args);
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

  protected async checkFileExists(
    root: string,
    name: string,
  ): Promise<string | undefined> {
    const configPath = this.fs.join(root, name);
    if (await this.fs.exists(configPath)) {
      return configPath;
    }
  }
}
