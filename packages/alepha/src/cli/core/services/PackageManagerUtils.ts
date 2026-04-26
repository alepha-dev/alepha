import { basename } from "node:path";
import { $inject, Alepha } from "alepha";
import type { RunnerMethod } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import { alephaPackageJson, version } from "../alephaPackageJson.ts";

/**
 * Context information about a workspace root.
 * Used when initializing a package inside a monorepo.
 */
export interface WorkspaceContext {
  /**
   * Whether we're inside a workspace package.
   */
  isPackage: boolean;
  /**
   * The workspace root directory (e.g., ../.. from packages/my-pkg).
   */
  workspaceRoot: string | null;
  /**
   * Package manager detected at workspace root.
   */
  packageManager: "yarn" | "pnpm" | "npm" | "bun" | null;
  /**
   * Config files present at workspace root.
   */
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
   * Checks current directory first, then workspace root if in a monorepo.
   */
  public async getPackageManager(
    root: string,
    pm?: "yarn" | "pnpm" | "npm" | "bun",
  ): Promise<"yarn" | "pnpm" | "npm" | "bun"> {
    if (pm) return pm;
    if (this.alepha.isBun()) return "bun";

    // Check current directory first
    if (await this.fs.exists(this.fs.join(root, "bun.lock"))) return "bun";
    if (await this.fs.exists(this.fs.join(root, "yarn.lock"))) return "yarn";
    if (await this.fs.exists(this.fs.join(root, "pnpm-lock.yaml")))
      return "pnpm";
    if (await this.fs.exists(this.fs.join(root, "package-lock.json")))
      return "npm";

    // Check workspace root (for monorepo packages like apps/blog)
    const workspace = await this.getWorkspaceContext(root);
    if (workspace.packageManager) {
      return workspace.packageManager;
    }

    return "npm";
  }

  /**
   * Detect workspace context when inside a monorepo package.
   *
   * Checks if we're inside a workspace package by walking up to 3 levels
   * for workspace indicators like lockfiles and config files.
   * This covers both standard layouts (packages/my-pkg) and deeper nesting
   * (packages/scope/my-pkg).
   *
   * @param root - The current package directory
   * @returns Workspace context with root path, PM, and config presence
   */
  public async getWorkspaceContext(root: string): Promise<WorkspaceContext> {
    const noContext: WorkspaceContext = {
      isPackage: false,
      workspaceRoot: null,
      packageManager: null,
      config: { biomeJson: false, editorconfig: false, tsconfigJson: false },
    };

    // Walk up 2–3 levels (covers packages/pkg and packages/scope/pkg)
    for (let depth = 2; depth <= 3; depth++) {
      const segments = Array.from({ length: depth }, () => "..");
      const candidate = this.fs.join(root, ...segments);

      // Don't check above filesystem root
      if (candidate === root) break;

      const result = await this.checkWorkspaceRoot(candidate);
      if (result) return result;
    }

    return noContext;
  }

  protected async checkWorkspaceRoot(
    candidate: string,
  ): Promise<WorkspaceContext | null> {
    const [hasYarnLock, hasPnpmLock, hasNpmLock, hasBunLock] =
      await Promise.all([
        this.fs.exists(this.fs.join(candidate, "yarn.lock")),
        this.fs.exists(this.fs.join(candidate, "pnpm-lock.yaml")),
        this.fs.exists(this.fs.join(candidate, "package-lock.json")),
        this.fs.exists(this.fs.join(candidate, "bun.lock")),
      ]);

    const hasLockfile = hasYarnLock || hasPnpmLock || hasNpmLock || hasBunLock;
    if (!hasLockfile) return null;

    const [hasBiome, hasEditorConfig, hasTsConfig, hasPackageJson] =
      await Promise.all([
        this.fs.exists(this.fs.join(candidate, "biome.json")),
        this.fs.exists(this.fs.join(candidate, ".editorconfig")),
        this.fs.exists(this.fs.join(candidate, "tsconfig.json")),
        this.fs.exists(this.fs.join(candidate, "package.json")),
      ]);

    if (!hasPackageJson) return null;

    let packageManager: "yarn" | "pnpm" | "npm" | "bun" | null = null;
    if (hasYarnLock) packageManager = "yarn";
    else if (hasPnpmLock) packageManager = "pnpm";
    else if (hasBunLock) packageManager = "bun";
    else if (hasNpmLock) packageManager = "npm";

    return {
      isPackage: true,
      workspaceRoot: candidate,
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
   * Optionally checks workspace root for the dependency in monorepo setups.
   */
  public async ensureDependency(
    root: string,
    packageName: string,
    options: {
      dev?: boolean;
      /**
       * Also check workspace root for the dependency (for monorepo setups).
       */
      checkWorkspace?: boolean;
      run?: RunnerMethod;
      exec?: (
        cmd: string,
        opts?: { global?: boolean; root?: string },
      ) => Promise<void>;
    } = {},
  ): Promise<void> {
    const { dev = true, checkWorkspace = false } = options;

    // Check current package
    if (await this.hasDependency(root, packageName)) {
      this.log.debug(`Dependency '${packageName}' is already installed`);
      return;
    }

    // Check workspace root (for monorepo setups)
    if (checkWorkspace) {
      const workspace = await this.getWorkspaceContext(root);
      if (workspace.workspaceRoot) {
        if (await this.hasDependency(workspace.workspaceRoot, packageName)) {
          this.log.debug(
            `Dependency '${packageName}' is already installed in workspace root`,
          );
          return;
        }
      }
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
      pkg.packageManager = undefined;
      return pkg;
    });
  }

  public async removePnpm(root: string): Promise<void> {
    await this.removeFiles(root, ["pnpm-lock.yaml", "pnpm-workspace.yaml"]);
    await this.editPackageJson(root, (pkg) => {
      pkg.packageManager = undefined;
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
      const dirName = basename(root) || "app";
      const content = {
        name: dirName,
        private: true,
        ...this.generatePackageJsonContent(modes),
      };
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

    const devDependencies: Record<string, string> = {
      vite: alephaDeps.vite,
    };

    // Only include drizzle-kit when the project uses a database.
    // React-only projects don't need it.
    if (!modes.react) {
      devDependencies["drizzle-kit"] = alephaDeps["drizzle-kit"];
    }

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

    if (modes.tailwind) {
      devDependencies.tailwindcss = "^4.2.0";
      devDependencies["@tailwindcss/vite"] = "^4.2.0";
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
  expo?: boolean;
  tailwind?: boolean;
  test?: boolean;
  /**
   * Skip biome/vitest when inside a workspace package (they're at root).
   */
  isPackage?: boolean;
}
