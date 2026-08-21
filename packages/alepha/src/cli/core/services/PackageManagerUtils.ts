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
    oxlintrc: boolean;
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
   *
   * Resolution order, strongest evidence first:
   *
   * 1. An explicit `--pm` flag
   * 2. A lockfile in the target directory
   * 3. The workspace root's package manager, in a monorepo
   * 4. How the CLI was invoked (`npm_config_user_agent`)
   * 5. The runtime, when running under Bun
   * 6. npm
   *
   * Step 4 is what makes `bunx alepha init` scaffold a Bun project and
   * `pnpm dlx alepha init` a pnpm one. It sits below the lockfile and
   * workspace checks on purpose: an existing project already decided, and
   * reaching for `npx` inside a Yarn repo should not switch it to npm.
   */
  public async getPackageManager(
    root: string,
    pm?: "yarn" | "pnpm" | "npm" | "bun",
  ): Promise<"yarn" | "pnpm" | "npm" | "bun"> {
    if (pm) return pm;

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

    const invoker = this.detectFromUserAgent();
    if (invoker) {
      return invoker;
    }

    if (this.alepha.isBun()) return "bun";

    return "npm";
  }

  /**
   * Read the package manager that spawned this process.
   *
   * Every major package manager sets `npm_config_user_agent` when it runs a
   * binary, so this survives `npx` / `bunx` / `pnpm dlx` / `yarn dlx` alike.
   */
  protected detectFromUserAgent(): "yarn" | "pnpm" | "npm" | "bun" | null {
    return this.parseUserAgent(process.env.npm_config_user_agent);
  }

  /**
   * Parse a `npm_config_user_agent` string.
   *
   * The value looks like `pnpm/9.12.0 npm/? node/v22.11.0 darwin arm64`,
   * so the leading token before the first slash names the manager.
   */
  protected parseUserAgent(
    agent: string | undefined,
  ): "yarn" | "pnpm" | "npm" | "bun" | null {
    const name = agent?.trim().split("/")[0];
    switch (name) {
      case "yarn":
      case "pnpm":
      case "npm":
      case "bun":
        return name;
      default:
        return null;
    }
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
      config: { oxlintrc: false, editorconfig: false, tsconfigJson: false },
    };

    // Walk up 1–3 levels: `monorepo/pkg` (depth 1) was never checked, so a
    // package directly under the workspace root reported no context at all.
    for (let depth = 1; depth <= 3; depth++) {
      const segments = Array.from({ length: depth }, () => "..");
      const candidate = this.fs.join(root, ...segments);

      // Don't check above filesystem root
      if (candidate === root) break;

      const result = await this.checkWorkspaceRoot(candidate);
      // A lockfile + package.json above us is not enough: an unrelated parent
      // repo would claim `alepha init` and skip git init / AGENTS.md / PM
      // setup, then install into the wrong root. Only trust the candidate if
      // it actually declares this directory as one of its workspaces.
      if (result && (await this.declaresWorkspace(candidate, root))) {
        return result;
      }
    }

    return noContext;
  }

  /**
   * Does `candidate`'s package.json declare `target` among its workspaces?
   *
   * Compares resolved paths against the (possibly globbed) `workspaces`
   * patterns. Unreadable or workspace-less package.json answers false — the
   * safe direction, since the consequence of a false positive is scaffolding
   * into someone else's repository.
   */
  protected async declaresWorkspace(
    candidate: string,
    target: string,
  ): Promise<boolean> {
    let patterns: string[];
    try {
      const raw = await this.fs.readFile(
        this.fs.join(candidate, "package.json"),
      );
      const pkg = JSON.parse(raw.toString("utf-8")) as {
        workspaces?: string[] | { packages?: string[] };
      };
      patterns = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : (pkg.workspaces?.packages ?? []);
    } catch {
      return false;
    }

    if (patterns.length === 0) {
      return false;
    }

    // `packages/*` -> `^packages/[^/]+$`, `packages/**` -> `^packages/.+$`.
    // The candidate is always an ancestor of the target (we walked up to it),
    // so a prefix strip is enough and avoids needing path.relative here.
    const normalise = (value: string) => value.replace(/\\/g, "/");
    const from = normalise(candidate).replace(/\/+$/, "");
    const to = normalise(target);
    if (!to.startsWith(`${from}/`)) {
      return false;
    }
    const relative = to.slice(from.length + 1);

    return patterns.some((pattern) => {
      // One pass, so `**` is matched before `*` without needing a sentinel.
      const source = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*|\*/g, (token) => (token === "**" ? ".*" : "[^/]*"));
      return new RegExp(`^${source}/?$`).test(relative);
    });
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

    const [hasOxlintrc, hasEditorConfig, hasTsConfig, hasPackageJson] =
      await Promise.all([
        this.fs.exists(this.fs.join(candidate, ".oxlintrc.json")),
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
        oxlintrc: hasOxlintrc,
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
    await this.ensurePnpmHoisting(root);
    await this.removeAllPmFilesExcept(root, "pnpm");
  }

  /**
   * Opt a pnpm project into a hoisted `node_modules`.
   *
   * `alepha` carries the toolchain — vite, vitest, typescript, oxlint/oxfmt,
   * drizzle-kit — in its own `dependencies`, and the scaffold's generated
   * files import part of it directly: `vite.config.ts` imports
   * `vitest/config`, and the dummy spec imports `vitest`. npm, bun and yarn
   * all hoist those transitives into the project's top-level `node_modules`,
   * so the imports resolve. pnpm's isolated linker does not, and the result
   * is a project that installs cleanly, prints "Project ready!", and then
   * fails `dev`, `build`, `test` and `typecheck` alike on
   * `Cannot find module 'vitest'`.
   *
   * {@link AlephaCliUtils.resolveBin} already covers the other half of the
   * same problem — a transitive's *bin* is not linked into `.bin` either —
   * which is why `lint` was the one script that survived. Nothing can fix
   * module resolution from the project's own source except the layout.
   *
   * Mirrors {@link ensureYarn} writing `nodeLinker: node-modules`: one
   * layout across all four managers, so there is one bug surface instead of
   * four. An `.npmrc` that already sets `node-linker` is left alone — that
   * is a deliberate choice by whoever wrote it.
   */
  protected async ensurePnpmHoisting(root: string): Promise<void> {
    const npmrcPath = this.fs.join(root, ".npmrc");
    const current = (await this.fs.exists(npmrcPath))
      ? (await this.fs.readFile(npmrcPath)).toString("utf-8")
      : "";

    if (/^\s*node-linker\s*=/m.test(current)) {
      return;
    }

    const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
    await this.fs.writeFile(
      npmrcPath,
      `${current}${prefix}node-linker=hoisted\n`,
    );
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

  /**
   * Write `package.json`, newline-terminated.
   *
   * `JSON.stringify` does not end with one, and every other tool that touches
   * this file does — npm, yarn and oxfmt all rewrite it with a trailing
   * newline. Without it, the scaffolder emitted the one file in a new project
   * that its own `alepha lint` immediately had to fix.
   */
  public async writePackageJson(
    root: string,
    content: Record<string, any>,
  ): Promise<void> {
    await this.fs.writeFile(
      this.fs.join(root, "package.json"),
      `${JSON.stringify(content, null, 2)}\n`,
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

    // The toolchain (typescript, vite, vitest, oxlint/oxfmt, drizzle-kit) is NOT
    // pinned here — it ships embedded as `dependencies` of `alepha`, so the
    // `alepha` CLI resolves and runs it from its own install. The project
    // never declares those versions; upgrading `alepha` moves the whole
    // toolchain atomically. See `AlephaCliUtils.resolveBin`.
    const devDependencies: Record<string, string> = {};

    const scripts: Record<string, string> = {
      dev: "alepha dev",
      build: "alepha build",
      test: "alepha test",
      lint: "alepha lint",
      typecheck: "alepha typecheck",
      verify: "alepha verify",
    };

    if (modes.tailwind) {
      devDependencies.tailwindcss = alephaDeps.tailwindcss;
      devDependencies["@tailwindcss/vite"] = alephaDeps["@tailwindcss/vite"];
    }

    if (modes.react) {
      dependencies.react = alephaDeps.react;
      dependencies["react-dom"] = alephaDeps["react-dom"];
      devDependencies["@types/react"] = alephaDeps["@types/react"];
    }

    // Dev-only (Vite `transformIndexHtml` + lazy `ssrLoadModule`), so it
    // costs nothing in a production bundle. Versioned in lockstep with
    // `alepha` itself, hence the same `version` rather than a devDeps lookup.
    if (modes.devtools) {
      devDependencies["@alepha/devtools"] = `^${version}`;
    }

    // One line, because `@alepha/ui` carries its own runtime deps
    // (`lucide-react`, `@base-ui/react`, `recharts`, …) rather than listing
    // them as peers. Same `version` as `alepha` and for a stronger reason
    // than devtools: its `alepha` peer range is exact, so the two only ever
    // resolve together.
    if (modes.ui) {
      dependencies["@alepha/ui"] = `^${version}`;
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
  /**
   * Whether the project is a workspace package inside a monorepo.
   */
  isPackage?: boolean;
  /**
   * Whether to ship the dev-only devtools UI. Resolved by the scaffolder —
   * default on for apps, always off for workspace packages.
   */
  devtools?: boolean;
  /**
   * Whether to depend on `@alepha/ui`. Set by the `saas` preset, which mounts
   * its auth, account and admin routers.
   */
  ui?: boolean;
}
