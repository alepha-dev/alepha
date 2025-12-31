import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $inject, Alepha, AlephaError } from "alepha";
import { EnvUtils, type RunnerMethod } from "alepha/command";
import { FileSystemProvider } from "alepha/file";
import { $logger } from "alepha/logger";
import { boot } from "alepha/vite";
import { tsImport } from "tsx/esm/api";
import { appRouterTs } from "../assets/appRouterTs.ts";
import { biomeJson } from "../assets/biomeJson.ts";
import { dummySpecTs } from "../assets/dummySpecTs.ts";
import { editorconfig } from "../assets/editorconfig.ts";
import { indexHtml } from "../assets/indexHtml.ts";
import { mainBrowserTs } from "../assets/mainBrowserTs.ts";
import { mainTs } from "../assets/mainTs.ts";
import { tsconfigJson } from "../assets/tsconfigJson.ts";
import { viteConfigTs } from "../assets/viteConfigTs.ts";
import { version } from "../version.ts";

/**
 * Utility service for common project operations used by CLI commands.
 *
 * This service provides helper methods for:
 * - Project configuration file management (tsconfig.json, package.json, etc.)
 * - Package manager setup (Yarn, npm, pnpm)
 * - Sample project downloading
 * - Drizzle ORM/Kit utilities
 * - Alepha instance loading
 */
export class AlephaCliUtils {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly envUtils = $inject(EnvUtils);

  /**
   * Execute a command using npx with inherited stdio.
   *
   * @example
   * ```ts
   * const runner = alepha.inject(ProcessRunner);
   * await runner.exec("tsx watch src/index.ts");
   * ```
   */
  public async exec(
    command: string,
    options: {
      env?: Record<string, string>;
      global?: boolean;
    } = {},
  ): Promise<void> {
    const root = process.cwd();
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
      true,
    );

    // or, find executable inside alepha package node_modules (pnpm style)
    if (!execPath) {
      execPath = await this.checkFileExists(
        root,
        `node_modules/alepha/node_modules/.bin/${app}${suffix}`,
        true,
      );
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

  // ===================================================================================================================
  // Package Manager & Project Setup
  // ===================================================================================================================

  /**
   * Ensure Yarn is configured in the project directory.
   *
   * Creates a .yarnrc.yml file with node-modules linker if it doesn't exist.
   *
   * @param root - The root directory of the project
   */
  public async ensureYarn(root: string): Promise<void> {
    await this.ensureFileExists(
      root,
      ".yarnrc.yml",
      "nodeLinker: node-modules",
      false,
    );

    // remove lock files from other package managers
    await this.fs.rm(join(root, "package-lock.json"), { force: true });
    await this.fs.rm(join(root, "pnpm-lock.yaml"), { force: true });
  }

  public async ensurePnpm(root: string): Promise<void> {
    // remove lock files from other package managers
    await this.fs.rm(join(root, "package-lock.json"), { force: true });
    await this.fs.rm(join(root, "yarn.lock"), { force: true });
    await this.fs.rm(join(root, ".yarn"), { force: true, recursive: true });
    await this.fs.rm(join(root, ".yarnrc.yml"), { force: true });
  }

  public async ensureNpm(root: string): Promise<void> {
    // remove lock files from other package managers
    await this.fs.rm(join(root, "pnpm-lock.yaml"), { force: true });
    await this.fs.rm(join(root, "yarn.lock"), { force: true });
    await this.fs.rm(join(root, ".yarn"), { force: true, recursive: true });
    await this.fs.rm(join(root, ".yarnrc.yml"), { force: true });
  }

  /**
   * Generate package.json content with Alepha dependencies.
   *
   * @param modes - Configuration for which dependencies to include
   * @returns Package.json partial with dependencies, devDependencies, and scripts
   */
  public generatePackageJsonContent(modes: DependencyModes): {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    scripts: Record<string, string>;
    type: "module";
  } {
    const dependencies: Record<string, string> = {
      alepha: `^${version}`,
    };

    const devDependencies: Record<string, string> = {};

    const scripts: Record<string, string> = {
      dev: "alepha dev",
      build: "alepha build",
      lint: "alepha lint",
      typecheck: "alepha typecheck",
      verify: "alepha verify",
    };

    if (modes.ui) {
      dependencies["@alepha/ui"] = `^${version}`;
      modes.react = true;
    }

    if (modes.react) {
      dependencies["@alepha/react"] = `^${version}`;
      dependencies.react = "^19.2.0";
      dependencies["react-dom"] = "^19.2.0";
      devDependencies["@types/react"] = "^19.2.0";
    }

    return {
      type: "module",
      dependencies,
      devDependencies,
      scripts,
    };
  }

  /**
   * Ensure package.json exists and has correct configuration.
   *
   * Creates a new package.json if none exists, or updates an existing one to:
   * - Set "type": "module"
   * - Add Alepha dependencies
   * - Add standard scripts
   *
   * @param root - The root directory of the project
   * @param modes - Configuration for which dependencies to include
   */
  public async ensurePackageJson(
    root: string,
    modes: DependencyModes,
  ): Promise<object> {
    const packageJsonPath = join(root, "package.json");
    try {
      await access(packageJsonPath);
    } catch (error) {
      const obj = this.generatePackageJsonContent(modes);
      await writeFile(packageJsonPath, JSON.stringify(obj, null, 2));
      return obj;
    }

    const content = await readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(content);

    const newPackageJson = this.generatePackageJsonContent(modes);

    packageJson.type = "module";
    packageJson.dependencies ??= {};
    packageJson.devDependencies ??= {};
    packageJson.scripts ??= {};

    Object.assign(packageJson.dependencies, newPackageJson.dependencies);
    Object.assign(packageJson.devDependencies, newPackageJson.devDependencies);
    Object.assign(packageJson.scripts, newPackageJson.scripts);

    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

    return packageJson;
  }

  public async ensureConfig(
    root: string,
    opts: {
      packageJson?: boolean | DependencyModes;
      tsconfigJson?: boolean;
      viteConfigTs?: boolean;
      indexHtml?: boolean;
      biomeJson?: boolean;
      editorconfig?: boolean;
    },
  ): Promise<Array<void | object>> {
    const tasks: Promise<void | object>[] = [];

    if (opts.packageJson) {
      tasks.push(
        this.ensurePackageJson(
          root,
          typeof opts.packageJson === "boolean" ? {} : opts.packageJson,
        ),
      );
    }
    if (opts.tsconfigJson) {
      tasks.push(this.ensureTsConfig(root));
    }
    if (opts.viteConfigTs) {
      tasks.push(this.ensureViteConfig(root));
    }
    if (opts.indexHtml) {
      tasks.push(this.ensureIndexHtml(root));
    }
    if (opts.biomeJson) {
      tasks.push(this.ensureBiomeConfig(root));
    }
    if (opts.editorconfig) {
      tasks.push(this.ensureEditorConfig(root));
    }

    return await Promise.all(tasks);
  }

  /**
   * Ensure tsconfig.json exists in the project.
   *
   * Creates a standard Alepha tsconfig.json if none exists.
   *
   * @param root - The root directory of the project
   */
  public async ensureTsConfig(root: string): Promise<void> {
    await this.ensureFileExists(root, "tsconfig.json", tsconfigJson, true);
  }

  /**
   * Ensure vite.config.ts exists in the project.
   *
   * Creates a standard Alepha vite.config.ts if none exists.
   */
  public async ensureViteConfig(
    root: string,
    serverEntry?: string,
  ): Promise<void> {
    await this.ensureFileExists(
      root,
      "vite.config.ts",
      viteConfigTs(serverEntry),
      false,
    );
  }

  protected async checkFileExists(
    root: string,
    name: string,
    checkParentDirectories: boolean = false,
  ): Promise<string | undefined> {
    const configPath = join(root, name);
    if (!checkParentDirectories) {
      try {
        await access(configPath);
        return configPath;
      } catch {
        return;
      }
    }

    let currentDir = root;
    const maxIterations = 10; // safety to prevent infinite loops
    let level = 0;

    while (level < maxIterations) {
      try {
        const maybe = join(currentDir, name);
        await access(maybe);
        return maybe;
      } catch {
        const parentDir = join(currentDir, "..");
        if (parentDir === currentDir) {
          break;
        }
        currentDir = parentDir;
      }
      level += 1;
    }
  }

  protected async ensureFileExists(
    root: string,
    name: string,
    content: string,
    checkParentDirectories: boolean = false,
  ): Promise<void> {
    const found = await this.checkFileExists(
      root,
      name,
      checkParentDirectories,
    );

    if (!found) {
      await writeFile(join(root, name), content);
    }
  }

  // ===================================================================================================================
  // Biome Configuration
  // ===================================================================================================================

  /**
   * Get the path to Biome configuration file.
   *
   * Looks for an existing biome.json in the project root, or creates one if it doesn't exist.
   */
  public async ensureBiomeConfig(root: string): Promise<void> {
    await this.ensureFileExists(root, "biome.json", biomeJson, true);
  }

  /**
   * Ensure .editorconfig exists in the project.
   *
   * Creates a standard .editorconfig if none exists.
   *
   * @param root - The root directory of the project
   */
  public async ensureEditorConfig(root: string): Promise<void> {
    await this.ensureFileExists(root, ".editorconfig", editorconfig, true);
  }

  // ===================================================================================================================
  // Drizzle ORM & Kit Utilities
  // ===================================================================================================================

  /**
   * Load Alepha instance from a server entry file.
   *
   * Dynamically imports the server entry file and extracts the Alepha instance.
   * Skips the automatic start process.
   *
   * @param rootDir - The root directory of the project
   * @param explicitEntry - Optional explicit path to the entry file
   * @returns Object containing the Alepha instance and the entry file path
   * @throws {AlephaError} If the Alepha instance cannot be found
   */
  public async loadAlephaFromServerEntryFile(
    rootDir?: string,
    explicitEntry?: string,
  ): Promise<{
    alepha: Alepha;
    entry: string;
  }> {
    process.env.ALEPHA_CLI_IMPORT = "true";

    const entry = await boot.getServerEntry(rootDir, explicitEntry);
    const mod = await tsImport(entry, {
      parentURL: import.meta.url,
    });

    this.log.debug(`Load entry: ${entry}`);

    // check if alepha is correctly exported
    if (mod.default instanceof Alepha) {
      return {
        alepha: mod.default,
        entry,
      };
    }

    // else, try with global variable
    const g: any = global;
    if (g.__alepha) {
      return {
        alepha: g.__alepha,
        entry,
      };
    }

    throw new AlephaError(
      `Could not find Alepha instance in entry file: ${entry}`,
    );
  }

  /**
   * Generate JavaScript code for Drizzle entities export.
   *
   * Creates a temporary entities.js file that imports from the entry file
   * and exports database models for Drizzle Kit to process.
   *
   * @param entry - Path to the server entry file
   * @param provider - Name of the database provider
   * @param models - Array of model names to export
   * @returns JavaScript code as a string
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

  /**
   * Load environment variables from a .env file.
   *
   * Reads the .env file in the specified root directory and sets
   * the environment variables in process.env.
   */
  public async loadEnv(
    root: string,
    files: string[] = [".env"],
  ): Promise<void> {
    await this.envUtils.loadEnv(root, files);
  }

  public async getPackageManager(
    root: string,
    flags?: { yarn?: boolean; pnpm?: boolean; npm?: boolean; bun?: boolean },
  ): Promise<"yarn" | "pnpm" | "npm" | "bun"> {
    if (flags?.yarn) {
      return "yarn";
    }
    if (flags?.pnpm) {
      return "pnpm";
    }
    if (flags?.npm) {
      return "npm";
    }
    if (flags?.bun) {
      return "bun";
    }
    if (await this.checkFileExists(root, "yarn.lock", true)) {
      return "yarn";
    }
    if (await this.checkFileExists(root, "pnpm-lock.yaml", true)) {
      return "pnpm";
    }
    return "npm";
  }

  public async ensureIndexHtml(root: string) {
    if (await this.fs.exists(join(root, "index.html"))) {
      return;
    }

    const serverEntry = "src/main.server.ts";
    const browserEntry = "src/main.browser.ts";
    const appRouter = "src/AppRouter.ts";

    await this.fs.writeFile(join(root, "index.html"), indexHtml(browserEntry));

    try {
      await this.fs.mkdir(join(root, "src"), { recursive: true });
    } catch {}

    if (!(await this.fs.exists(join(root, browserEntry)))) {
      await this.fs.writeFile(join(root, browserEntry), mainBrowserTs());
    }

    if (!(await this.fs.exists(join(root, serverEntry)))) {
      await this.fs.writeFile(join(root, serverEntry), mainBrowserTs());
    }

    if (!(await this.fs.exists(join(root, appRouter)))) {
      await this.fs.writeFile(join(root, appRouter), appRouterTs());
    }
  }

  public async exists(root: string, dirName: string): Promise<boolean> {
    return this.fs.exists(join(root, dirName));
  }

  /**
   * Ensure src/main.ts exists with a minimal Alepha bootstrap.
   *
   * Creates the src directory and main.ts file if the src directory
   * doesn't exist or is empty.
   *
   * @param root - The root directory of the project
   */
  public async ensureSrcMain(root: string): Promise<void> {
    const srcDir = join(root, "src");
    const mainPath = join(srcDir, "main.ts");

    // Check if src directory exists
    const srcExists = await this.fs.exists(srcDir);

    if (!srcExists) {
      // Create src directory and main.ts
      await this.fs.mkdir(srcDir, { recursive: true });
      await this.fs.writeFile(mainPath, mainTs());
      return;
    }

    // Check if src directory is empty
    const files = await this.fs.ls(srcDir);
    if (files.length === 0) {
      await this.fs.writeFile(mainPath, mainTs());
    }
  }

  /**
   * Ensure test directory exists with a dummy test file.
   *
   * Creates the test directory and a dummy.spec.ts file if the test directory
   * doesn't exist or is empty.
   *
   * @param root - The root directory of the project
   */
  public async ensureTestDir(root: string): Promise<void> {
    const testDir = join(root, "test");
    const dummyPath = join(testDir, "dummy.spec.ts");

    // Check if test directory exists
    const testExists = await this.fs.exists(testDir);

    if (!testExists) {
      // Create test directory and dummy.spec.ts
      await this.fs.mkdir(testDir, { recursive: true });
      await this.fs.writeFile(dummyPath, dummySpecTs());
      return;
    }

    // Check if test directory is empty
    const files = await this.fs.ls(testDir);
    if (files.length === 0) {
      await this.fs.writeFile(dummyPath, dummySpecTs());
    }
  }

  async readPackageJson(root: string): Promise<Record<string, any>> {
    const packageJson = await this.fs
      .createFile({
        path: join(root, "package.json"),
      })
      .text();
    return JSON.parse(packageJson);
  }

  /**
   * Check if a dependency is installed in the project.
   *
   * @param root - The root directory of the project
   * @param packageName - The name of the package to check
   * @returns True if the package is in dependencies or devDependencies
   */
  async hasDependency(root: string, packageName: string): Promise<boolean> {
    try {
      const pkg = await this.readPackageJson(root);
      return !!(
        pkg.dependencies?.[packageName] || pkg.devDependencies?.[packageName]
      );
    } catch {
      return false;
    }
  }

  /**
   * Check if Expo is present in the project.
   *
   * @param root - The root directory of the project
   * @returns True if expo is in dependencies or devDependencies
   */
  async hasExpo(root: string): Promise<boolean> {
    return this.hasDependency(root, "expo");
  }

  /**
   * Install a dependency if it's missing from the project.
   *
   * Automatically detects the package manager (yarn, pnpm, npm) and installs
   * the package as a dev dependency if not already present.
   */
  async ensureDependency(
    root: string,
    packageName: string,
    options: { dev?: boolean; run?: RunnerMethod } = {},
  ): Promise<void> {
    const { dev = true } = options;

    if (await this.hasDependency(root, packageName)) {
      this.log.debug(`Dependency '${packageName}' is already installed`);
      return;
    }

    const pm = await this.getPackageManager(root);
    let cmd: string;

    switch (pm) {
      case "yarn":
        cmd = `yarn add ${dev ? "-D" : ""} ${packageName}`;
        break;
      case "pnpm":
        cmd = `pnpm add ${dev ? "-D" : ""} ${packageName}`;
        break;
      default:
        cmd = `npm install ${dev ? "--save-dev" : ""} ${packageName}`;
    }

    cmd = cmd.replace(/\s+/g, " ").trim();

    if (options.run) {
      // if it's during a Runner flow, just use the runner's run method
      await options.run(cmd, {
        alias: `installing ${packageName}`,
      });
    } else {
      // else, run directly with our util exec method
      this.log.debug(`Installing ${packageName}`);
      await this.exec(cmd, { global: true });
    }
  }
}

export interface DependencyModes {
  react?: boolean;
  ui?: boolean;
  expo?: boolean;
}
