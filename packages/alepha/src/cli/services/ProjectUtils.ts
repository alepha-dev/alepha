import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $inject, Alepha, AlephaError } from "alepha";
import { FileSystemProvider } from "alepha/file";
import { $logger } from "alepha/logger";
import type { RepositoryProvider } from "alepha/orm";
import { boot } from "alepha/vite";
import { tsImport } from "tsx/esm/api";
import { biomeJson } from "../assets/biomeJson.ts";
import { indexHtml } from "../assets/indexHtml.ts";
import { tsconfigJson } from "../assets/tsconfigJson.ts";
import { viteConfigTs } from "../assets/viteConfigTs.ts";
import { version } from "../version.ts";
import { ProcessRunner } from "./ProcessRunner.ts";

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
export class ProjectUtils {
  protected readonly log = $logger();
  protected readonly runner = $inject(ProcessRunner);
  protected readonly fs = $inject(FileSystemProvider);

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
    const yarnrcPath = join(root, ".yarnrc.yml");
    try {
      await access(yarnrcPath);
    } catch {
      await writeFile(yarnrcPath, "nodeLinker: node-modules");
    }

    // remove lock files from other package managers
    const npmLockPath = join(root, "package-lock.json");
    const pnpmLockPath = join(root, "pnpm-lock.yaml");
    await this.fs.rm(npmLockPath, { force: true });
    await this.fs.rm(pnpmLockPath, { force: true });
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

    if (modes.react) {
      dependencies["@alepha/react"] = `^${version}`;
      dependencies.react = "19.1.0";
      devDependencies["@types/react"] = "19.1.0";
    }

    return {
      type: "module",
      dependencies,
      devDependencies,
      scripts: {
        dev: "alepha dev",
        build: "alepha build",
      },
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
  ): Promise<void> {
    const packageJsonPath = join(root, "package.json");
    try {
      await access(packageJsonPath);
    } catch (error) {
      await writeFile(
        packageJsonPath,
        JSON.stringify(this.generatePackageJsonContent(modes), null, 2),
      );
      return;
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
  }

  /**
   * Ensure package.json exists and is configured as ES module.
   *
   * Similar to ensurePackageJson but only validates/sets the "type": "module" field.
   * Throws an error if no package.json exists.
   *
   * @param root - The root directory of the project
   * @throws {AlephaError} If no package.json is found
   */
  public async ensurePackageJsonModule(root: string): Promise<void> {
    const packageJsonPath = join(root, "package.json");
    try {
      await access(packageJsonPath);
    } catch (error) {
      throw new AlephaError(
        "No package.json found in project root. Run 'npx alepha init' to create one.",
      );
    }

    const content = await readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(content);
    if (!packageJson.type || packageJson.type !== "module") {
      packageJson.type = "module";
      await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
    }
  }

  /**
   * Ensure tsconfig.json exists in the project.
   *
   * Creates a standard Alepha tsconfig.json if none exists.
   *
   * @param root - The root directory of the project
   */
  public async ensureTsConfig(root: string): Promise<void> {
    const tsconfigPath = join(root, "tsconfig.json");
    try {
      await access(tsconfigPath);
    } catch {
      await writeFile(tsconfigPath, tsconfigJson);
    }
  }

  // ===================================================================================================================
  // Biome Configuration
  // ===================================================================================================================

  /**
   * Get the path to Biome configuration file.
   *
   * Looks for an existing biome.json in the project root, or creates one if it doesn't exist.
   *
   * @param maybePath - Optional custom path to biome config
   * @returns Absolute path to the biome.json config file
   */
  public async getBiomeConfigPath(maybePath?: string): Promise<string> {
    const root = process.cwd();
    if (maybePath) {
      try {
        const path = join(root, maybePath);
        await access(path);
        return path;
      } catch {}
    }

    try {
      const path = join(root, "biome.json");
      await access(path);
      return path;
    } catch {
      return await this.runner.writeConfigFile("biome.json", biomeJson);
    }
  }

  // ===================================================================================================================
  // Vite Configuration
  // ===================================================================================================================

  /**
   * Get the path to Vite configuration file.
   *
   * Looks for an existing vite.config.ts in the project root, or creates one if it doesn't exist.
   *
   * @param root - The root directory of the project (defaults to process.cwd())
   * @param serverEntry - Optional path to the server entry file to include in the config
   * @returns Absolute path to the vite.config.ts file
   */
  public async getViteConfigPath(
    root: string,
    serverEntry?: string,
  ): Promise<string> {
    try {
      const viteConfigPath = join(root, "vite.config.ts");
      await access(viteConfigPath);
      return viteConfigPath;
    } catch {
      return this.runner.writeConfigFile(
        "vite.config.ts",
        viteConfigTs(serverEntry),
      );
    }
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
    process.env.ALEPHA_SKIP_START = "true";

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
   * Get DrizzleKitProvider from an Alepha instance.
   *
   * Searches the Alepha registry for the DrizzleKitProvider instance.
   *
   * @param alepha - The Alepha instance to search
   * @returns The DrizzleKitProvider instance
   */
  public getKitFromAlepha(alepha: Alepha): any {
    // biome-ignore lint/complexity/useLiteralKeys: private key
    return alepha["registry"]
      .values()
      .find((it: any) => it.instance.constructor.name === "DrizzleKitProvider")
      ?.instance;
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
   * Prepare Drizzle configuration files for a database provider.
   *
   * Creates temporary entities.js and drizzle.config.js files needed
   * for Drizzle Kit commands to run properly.
   *
   * @param options - Configuration options including kit, provider info, and paths
   * @returns Path to the generated drizzle.config.js file
   */
  public async prepareDrizzleConfig(options: {
    kit: any;
    provider: any;
    providerName: string;
    providerUrl: string;
    dialect: string;
    entry: string;
    rootDir: string;
  }): Promise<string> {
    const models = Object.keys(options.kit.getModels(options.provider));
    const entitiesJs = this.generateEntitiesJs(
      options.entry,
      options.providerName,
      models,
    );

    const entitiesJsPath = await this.runner.writeConfigFile(
      "entities.js",
      entitiesJs,
      options.rootDir,
    );

    const config: Record<string, any> = {
      schema: entitiesJsPath,
      out: `./migrations/${options.providerName}`,
      dialect: options.dialect,
      dbCredentials: {
        url: options.providerUrl,
      },
    };

    if (options.providerName === "pglite") {
      config.driver = "pglite";
    }

    const drizzleConfigJs = `export default ${JSON.stringify(config, null, 2)}`;

    return await this.runner.writeConfigFile(
      "drizzle.config.js",
      drizzleConfigJs,
      options.rootDir,
    );
  }

  /**
   * Run a drizzle-kit command for all database providers in an Alepha instance.
   *
   * Iterates through all repository providers, prepares Drizzle config for each,
   * and executes the specified drizzle-kit command.
   *
   * @param options - Configuration including command to run, flags, and logging
   */
  public async runDrizzleKitCommand(options: {
    root: string;
    args?: string;
    command: string;
    commandFlags?: string;
    provider?: string;
    logMessage: (providerName: string, dialect: string) => string;
  }): Promise<void> {
    const rootDir = options.root;
    this.log.debug(`Using project root: ${rootDir}`);

    const { alepha, entry } = await this.loadAlephaFromServerEntryFile(
      rootDir,
      options.args,
    );

    const kit = this.getKitFromAlepha(alepha);
    const repositoryProvider =
      alepha.inject<RepositoryProvider>("RepositoryProvider");
    const accepted = new Set<string>([]);

    for (const descriptor of repositoryProvider.getRepositories()) {
      const provider = descriptor.provider;
      const providerName = provider.name;
      const dialect = provider.dialect;

      if (accepted.has(providerName)) {
        continue;
      }
      accepted.add(providerName);

      // Skip if provider filter is set and doesn't match
      if (options.provider && options.provider !== providerName) {
        this.log.debug(
          `Skipping provider '${providerName}' (filter: ${options.provider})`,
        );
        continue;
      }

      this.log.info("");
      this.log.info(options.logMessage(providerName, dialect));

      const drizzleConfigJsPath = await this.prepareDrizzleConfig({
        kit,
        provider,
        providerName,
        providerUrl: provider.url,
        dialect,
        entry,
        rootDir,
      });

      const flags = options.commandFlags ? ` ${options.commandFlags}` : "";
      await this.runner.exec(
        `drizzle-kit ${options.command} --config=${drizzleConfigJsPath}${flags}`,
      );
    }
  }

  public async getPackageManager(
    root: string,
  ): Promise<"yarn" | "pnpm" | "npm"> {
    if (await this.fs.exists(join(root, "yarn.lock"))) {
      return "yarn";
    } else if (await this.fs.exists(join(root, "pnpm-lock.yaml"))) {
      return "pnpm";
    } else {
      return "npm";
    }
  }

  public async ensureIndexHtml(root: string) {
    if (await this.fs.exists(join(root, "index.html"))) {
      return;
    }

    const entry = await boot.getServerEntry(root).catch(() => null);
    await this.fs.writeFile(
      join(root, "index.html"),
      indexHtml(entry ? entry.replace(root, "") : undefined),
    );
  }
}

export interface DependencyModes {
  react?: boolean;
  // testing?: boolean;
  // ui?: boolean;
}
