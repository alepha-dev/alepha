import { $inject, Alepha } from "alepha";
import type { RunnerMethod } from "alepha/command";
import { FileSystemProvider } from "alepha/file";
import { $logger } from "alepha/logger";
import { version } from "../version.ts";

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
    flags?: { yarn?: boolean; pnpm?: boolean; npm?: boolean; bun?: boolean },
  ): Promise<"yarn" | "pnpm" | "npm" | "bun"> {
    if (flags?.yarn) return "yarn";
    if (flags?.pnpm) return "pnpm";
    if (flags?.npm) return "npm";
    if (flags?.bun) return "bun";
    if (this.alepha.isBun()) return "bun";
    if (await this.fs.exists(this.fs.join(root, "bun.lock"))) return "bun";
    if (await this.fs.exists(this.fs.join(root, "yarn.lock"))) return "yarn";
    if (await this.fs.exists(this.fs.join(root, "pnpm-lock.yaml")))
      return "pnpm";
    return "npm";
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
      await options.run(cmd, { alias: `installing ${packageName}`, root });
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
}
