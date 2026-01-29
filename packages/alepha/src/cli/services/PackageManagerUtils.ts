import { $inject, Alepha } from "alepha";
import type { RunnerMethod } from "alepha/command";
import { $logger } from "alepha/logger";
import alephaPackageJson from "alepha/package.json" with { type: "json" };
import { FileSystemProvider } from "alepha/system";
import { version } from "../version.ts";

/**
 * Context information about a workspace root.
 * Used when initializing a package inside a monorepo.
 */
export interface WorkspaceContext {
  /** Whether we're inside a workspace package */
  isPackage: boolean;
  /** The workspace root directory (e.g., ../.. from packages/my-pkg) */
  workspaceRoot: string | null;
  /** Package manager detected at workspace root */
  packageManager: "yarn" | "pnpm" | "npm" | "bun" | null;
  /** Config files present at workspace root */
  config: {
    biomeJson: boolean;
    editorconfig: boolean;
    tsconfigJson: boolean;
  };
}

/**
 * Utility service for package manager operations.
 *
 * Handles detection, installation, and cleanup for:
 * - Yarn
 * - npm
 * - pnpm
 * - Bun
 */
export class PackageManagerUtils {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly alepha = $inject(Alepha);

  /**
   * Detect the package manager used in the project.
   */
  public async getPackageManager(
    root: string,
    pm?: "yarn" | "pnpm" | "npm" | "bun",
  ): Promise<"yarn" | "pnpm" | "npm" | "bun"> {
    if (pm) return pm;
    if (this.alepha.isBun()) return "bun";
    if (await this.fs.exists(this.fs.join(root, "bun.lock"))) return "bun";
    if (await this.fs.exists(this.fs.join(root, "yarn.lock"))) return "yarn";
    if (await this.fs.exists(this.fs.join(root, "pnpm-lock.yaml")))
      return "pnpm";
    return "npm";
  }

  /**
   * Detect workspace context when inside a monorepo package.
   *
   * Checks if we're inside a workspace package (e.g., packages/my-pkg or apps/my-app)
   * by looking 2 levels up for workspace indicators like lockfiles and config files.
   *
   * @param root - The current package directory
   * @returns Workspace context with root path, PM, and config presence
   */
  public async getWorkspaceContext(root: string): Promise<WorkspaceContext> {
    // Workspace root is 2 levels up (e.g., packages/my-pkg → ..)
    const workspaceRoot = this.fs.join(root, "..", "..");

    // Check for lockfiles to detect PM
    const [hasYarnLock, hasPnpmLock, hasNpmLock, hasBunLock] =
      await Promise.all([
        this.fs.exists(this.fs.join(workspaceRoot, "yarn.lock")),
        this.fs.exists(this.fs.join(workspaceRoot, "pnpm-lock.yaml")),
        this.fs.exists(this.fs.join(workspaceRoot, "package-lock.json")),
        this.fs.exists(this.fs.join(workspaceRoot, "bun.lock")),
      ]);

    // Check for config files
    const [hasBiome, hasEditorConfig, hasTsConfig, hasWorkspacePackageJson] =
      await Promise.all([
        this.fs.exists(this.fs.join(workspaceRoot, "biome.json")),
        this.fs.exists(this.fs.join(workspaceRoot, ".editorconfig")),
        this.fs.exists(this.fs.join(workspaceRoot, "tsconfig.json")),
        this.fs.exists(this.fs.join(workspaceRoot, "package.json")),
      ]);

    // Determine if this looks like a workspace root
    const hasLockfile = hasYarnLock || hasPnpmLock || hasNpmLock || hasBunLock;
    const isPackage = hasLockfile && hasWorkspacePackageJson;

    // Detect package manager from lockfile
    let packageManager: "yarn" | "pnpm" | "npm" | "bun" | null = null;
    if (hasYarnLock) packageManager = "yarn";
    else if (hasPnpmLock) packageManager = "pnpm";
    else if (hasBunLock) packageManager = "bun";
    else if (hasNpmLock) packageManager = "npm";

    return {
      isPackage,
      workspaceRoot: isPackage ? workspaceRoot : null,
      packageManager,
      config: {
        biomeJson: hasBiome,
        editorconfig: hasEditorConfig,
        tsconfigJson: hasTsConfig,
      },
    };
  }

  /**
   * Get the install command for a package.
   */
  public async getInstallCommand(
    root: string,
    packageName: string,
    dev = true,
  ): Promise<string> {
    const pm = await this.getPackageManager(root);
    let cmd: string;

    switch (pm) {
      case "yarn":
        cmd = `yarn add ${dev ? "-D" : ""} ${packageName}`;
        break;
      case "pnpm":
        cmd = `pnpm add ${dev ? "-D" : ""} ${packageName}`;
        break;
      case "bun":
        cmd = `bun add ${dev ? "-d" : ""} ${packageName}`;
        break;
      default:
        cmd = `npm install ${dev ? "--save-dev" : ""} ${packageName}`;
    }

    return cmd.replace(/\s+/g, " ").trim();
  }

  /**
   * Check if a dependency is installed in the project.
   */
  public async hasDependency(
    root: string,
    packageName: string,
  ): Promise<boolean> {
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
   */
  public async hasExpo(root: string): Promise<boolean> {
    return this.hasDependency(root, "expo");
  }

  /**
   * Check if React is present in the project.
   */
  public async hasReact(root: string): Promise<boolean> {
    return this.hasDependency(root, "react");
  }

  /**
   * Install a dependency if it's missing from the project.
   */
  public async ensureDependency(
    root: string,
    packageName: string,
    options: {
      dev?: boolean;
      run?: RunnerMethod;
      exec?: (
        cmd: string,
        opts?: { global?: boolean; root?: string },
      ) => Promise<void>;
    } = {},
  ): Promise<void> {
    const { dev = true } = options;

    if (await this.hasDependency(root, packageName)) {
      this.log.debug(`Dependency '${packageName}' is already installed`);
      return;
    }

    const cmd = await this.getInstallCommand(root, packageName, dev);

    if (options.run) {
      await options.run(cmd, { alias: `add ${packageName}`, root });
    } else if (options.exec) {
      this.log.debug(`Installing ${packageName}`);
      await options.exec(cmd, { global: true, root });
    }
  }

  // ===========================================
  // Package Manager Setup & Cleanup
  // ===========================================

  public async ensureYarn(root: string): Promise<void> {
    const yarnrcPath = this.fs.join(root, ".yarnrc.yml");
    if (!(await this.fs.exists(yarnrcPath))) {
      await this.fs.writeFile(yarnrcPath, "nodeLinker: node-modules");
    }
    await this.removeAllPmFilesExcept(root, "yarn");
  }

  public async ensureBun(root: string): Promise<void> {
    await this.removeAllPmFilesExcept(root, "bun");
  }

  public async ensurePnpm(root: string): Promise<void> {
    await this.removeAllPmFilesExcept(root, "pnpm");
  }

  public async ensureNpm(root: string): Promise<void> {
    await this.removeAllPmFilesExcept(root, "npm");
  }

  public async removeAllPmFilesExcept(
    root: string,
    except: string,
  ): Promise<void> {
    if (except !== "yarn") await this.removeYarn(root);
    if (except !== "pnpm") await this.removePnpm(root);
    if (except !== "npm") await this.removeNpm(root);
    if (except !== "bun") await this.removeBun(root);
  }

  public async removeYarn(root: string): Promise<void> {
    await this.removeFiles(root, [".yarn", ".yarnrc.yml", "yarn.lock"]);
    await this.editPackageJson(root, (pkg) => {
      delete pkg.packageManager;
      return pkg;
    });
  }

  public async removePnpm(root: string): Promise<void> {
    await this.removeFiles(root, ["pnpm-lock.yaml", "pnpm-workspace.yaml"]);
    await this.editPackageJson(root, (pkg) => {
      delete pkg.packageManager;
      return pkg;
    });
  }

  public async removeNpm(root: string): Promise<void> {
    await this.removeFiles(root, ["package-lock.json"]);
  }

  public async removeBun(root: string): Promise<void> {
    await this.removeFiles(root, ["bun.lockb", "bun.lock"]);
  }

  // ===========================================
  // Package.json utilities
  // ===========================================

  public async readPackageJson(root: string): Promise<Record<string, any>> {
    const content = await this.fs
      .createFile({ path: this.fs.join(root, "package.json") })
      .text();
    return JSON.parse(content);
  }

  public async writePackageJson(
    root: string,
    content: Record<string, any>,
  ): Promise<void> {
    await this.fs.writeFile(
      this.fs.join(root, "package.json"),
      JSON.stringify(content, null, 2),
    );
  }

  public async editPackageJson(
    root: string,
    editFn: (pkg: Record<string, any>) => Record<string, any>,
  ): Promise<void> {
    try {
      const pkg = await this.readPackageJson(root);
      const updated = editFn(pkg);
      await this.writePackageJson(root, updated);
    } catch {
      // package.json doesn't exist, skip
    }
  }

  public async ensurePackageJson(
    root: string,
    modes: DependencyModes,
  ): Promise<Record<string, any>> {
    const packageJsonPath = this.fs.join(root, "package.json");

    if (!(await this.fs.exists(packageJsonPath))) {
      const content = this.generatePackageJsonContent(modes);
      await this.writePackageJson(root, content);
      return content;
    }

    const packageJson = await this.readPackageJson(root);
    const newContent = this.generatePackageJsonContent(modes);

    packageJson.type = "module";
    packageJson.dependencies ??= {};
    packageJson.devDependencies ??= {};
    packageJson.scripts ??= {};

    Object.assign(packageJson.dependencies, newContent.dependencies);
    Object.assign(packageJson.devDependencies, newContent.devDependencies);
    Object.assign(packageJson.scripts, newContent.scripts);

    await this.writePackageJson(root, packageJson);
    return packageJson;
  }

  public generatePackageJsonContent(modes: DependencyModes): {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    scripts: Record<string, string>;
    type: "module";
  } {
    const alephaDeps = alephaPackageJson.devDependencies;

    const dependencies: Record<string, string> = {
      alepha: `^${version}`,
    };

    const devDependencies: Record<string, string> = {};

    // Add biome/vitest only if not a workspace package (workspace root has them)
    if (!modes.isPackage) {
      devDependencies["@biomejs/biome"] = alephaDeps["@biomejs/biome"];
      if (modes.test) {
        devDependencies.vitest = alephaDeps.vitest;
      }
    }

    const scripts: Record<string, string> = {
      dev: "alepha dev",
      build: "alepha build",
      lint: "alepha lint",
      typecheck: "alepha typecheck",
      verify: "alepha verify",
    };

    if (modes.test) {
      scripts.test = "vitest run";
    }

    if (modes.ui) {
      dependencies["@alepha/ui"] = `^${version}`;
      modes.react = true;
    }

    if (modes.react) {
      dependencies.react = alephaDeps.react;
      dependencies["react-dom"] = alephaDeps["react-dom"];
      devDependencies["@types/react"] = alephaDeps["@types/react"];
    }

    return {
      type: "module",
      dependencies,
      devDependencies,
      scripts,
    };
  }

  // ===========================================
  // Helper methods
  // ===========================================

  protected async removeFiles(root: string, files: string[]): Promise<void> {
    await Promise.all(
      files.map((file) =>
        this.fs.rm(this.fs.join(root, file), { force: true, recursive: true }),
      ),
    );
  }
}

export interface DependencyModes {
  react?: boolean;
  ui?: boolean;
  expo?: boolean;
  test?: boolean;
  /** Skip biome/vitest when inside a workspace package (they're at root) */
  isPackage?: boolean;
}
