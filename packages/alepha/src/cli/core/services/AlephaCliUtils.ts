import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { $inject, Alepha, AlephaError } from "alepha";
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
   * Resolve the absolute path to a toolchain binary that ships embedded in
   * `alepha`'s own `dependencies` (typescript, vite, vitest, oxlint, oxfmt,
   * drizzle-kit).
   *
   * The CLI runs the result via `node <path>` so the toolchain works under
   * every package manager — including pnpm with a strict node-linker, where
   * a transitive dependency's bin is NOT hoisted into the project's
   * `node_modules/.bin`. Resolution starts from `alepha`'s own location, so
   * the version is whatever `alepha` shipped — the project never pins it.
   *
   * @param pkg - npm package name (e.g. `"typescript"`)
   * @param binName - which `bin` entry to use (e.g. `"tsc"`); defaults to the
   *   package's only/first bin
   */
  public resolveBin(pkg: string, binName?: string): string {
    const pkgDir = this.resolvePackageDir(pkg);

    const meta = JSON.parse(
      readFileSync(join(pkgDir, "package.json"), "utf8"),
    ) as { bin?: string | Record<string, string> };
    const bin = meta.bin;
    if (!bin) {
      throw new AlephaError(`Package '${pkg}' declares no 'bin' entry`);
    }
    const rel =
      typeof bin === "string"
        ? bin
        : (bin[binName ?? pkg] ?? Object.values(bin)[0]);
    if (!rel) {
      throw new AlephaError(`Package '${pkg}' has no bin named '${binName}'`);
    }
    return join(pkgDir, rel);
  }

  /**
   * Resolve the absolute directory of a package that ships embedded in
   * `alepha`'s own `dependencies`, starting the lookup from `alepha`'s own
   * location rather than the project's.
   *
   * Needed on top of {@link resolveBin} because an embedded bin may import a
   * sibling embedded package at runtime: `drizzle-kit` reaches for
   * `drizzle-orm`. When the installer hoists the two to different depths, the
   * bin cannot see its sibling, and the caller has to say where it is.
   *
   * @param pkg - npm package name (e.g. `"drizzle-orm"`)
   */
  public resolvePackageDir(pkg: string): string {
    const require = createRequire(import.meta.url);

    // Locate the package root by scanning the `node_modules` directories
    // Node would search, then reading `package.json` from disk directly.
    // We deliberately avoid `require.resolve("<pkg>/package.json")` — a
    // strict `exports` map (e.g. drizzle-kit) blocks that subpath.
    for (const nm of require.resolve.paths(pkg) ?? []) {
      const candidate = join(nm, pkg);
      if (existsSync(join(candidate, "package.json"))) {
        return candidate;
      }
    }

    throw new AlephaError(
      `Cannot locate package '${pkg}' — is it installed alongside alepha?`,
    );
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

  /**
   * Import a module through the app's graph rather than the CLI's.
   *
   * See {@link ViteUtils.importFromAppGraph}. Only valid after
   * {@link loadAlephaFromServerEntryFile}.
   */
  public importFromAppGraph<T = any>(specifier: string): Promise<T> {
    return this.viteUtils.importFromAppGraph<T>(specifier);
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
