import { basename, dirname } from "node:path";
import { $inject, AlephaError } from "alepha";
import type { RunnerMethod } from "alepha/command";
import { $logger, ConsoleColorProvider } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import { agentMd } from "../templates/agentMd.ts";
import { alephaConfigTs } from "../templates/alephaConfigTs.ts";
import { apiHelloControllerTs } from "../templates/apiHelloControllerTs.ts";
import { apiHelloResponseSchemaTs } from "../templates/apiHelloResponseSchemaTs.ts";
import { apiIndexTs } from "../templates/apiIndexTs.ts";
import { biomeJson } from "../templates/biomeJson.ts";
import { dummySpecTs } from "../templates/dummySpecTs.ts";
import { editorconfig } from "../templates/editorconfig.ts";
import { envExample } from "../templates/envExample.ts";
import { gitignore } from "../templates/gitignore.ts";
import { logoSvg } from "../templates/logoSvg.ts";
import { mainBrowserTs } from "../templates/mainBrowserTs.ts";
import { mainCss } from "../templates/mainCss.ts";
import { mainServerTs } from "../templates/mainServerTs.ts";
import { tsconfigJson } from "../templates/tsconfigJson.ts";
import { viteConfigTs } from "../templates/viteConfigTs.ts";
import { vitestConfigTs } from "../templates/vitestConfigTs.ts";
import { vscodeSettingsJson } from "../templates/vscodeSettingsJson.ts";
import { webAppRouterTs } from "../templates/webAppRouterTs.ts";
import { webHomeComponentTsx } from "../templates/webHomeComponentTsx.ts";
import { webIndexTs } from "../templates/webIndexTs.ts";
import { AlephaCliUtils } from "./AlephaCliUtils.ts";
import {
  type DependencyModes,
  PackageManagerUtils,
} from "./PackageManagerUtils.ts";

/**
 * Service for scaffolding new Alepha projects.
 *
 * Handles creation of:
 * - Project structure (src/api, src/web)
 * - Configuration files (tsconfig, biome, editorconfig)
 * - Entry points (main.server.ts, main.browser.ts)
 * - Example code (HelloController, Home component)
 */
export class ProjectScaffolder {
  protected readonly log = $logger();
  protected readonly colors = $inject(ConsoleColorProvider);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly utils = $inject(AlephaCliUtils);

  /**
   * Get the app name from the directory name.
   *
   * Converts the directory name to a valid module name:
   * - Converts to lowercase
   * - Replaces spaces, dashes, underscores with nothing
   * - Falls back to "app" if empty
   */
  public getAppName(root: string): string {
    const dirName = basename(root);
    const appName = dirName.toLowerCase().replace(/[\s\-_.\d]/g, "");
    return appName || "app";
  }

  /**
   * Ensure all configuration files exist.
   */
  public async ensureConfig(
    root: string,
    opts: {
      force?: boolean;
      /**
       * Check workspace root for existing config files.
       */
      checkWorkspace?: boolean;
      packageJson?: boolean | DependencyModes;
      tsconfigJson?: boolean;
      biomeJson?: boolean;
      editorconfig?: boolean;
      /**
       * Write `.env.example`, the committed template for `.env`.
       */
      envExample?: boolean;
      agentMd?: boolean;
      /**
       * Write `.vscode/settings.json` pointing the editor's TypeScript
       * server at the `typescript` copy embedded in `alepha`.
       */
      vscodeSettings?: boolean;
    },
  ): Promise<void> {
    const tasks: Promise<void>[] = [];
    const force = opts.force ?? false;
    const checkWorkspace = opts.checkWorkspace ?? false;

    if (opts.packageJson) {
      tasks.push(
        this.pm
          .ensurePackageJson(
            root,
            typeof opts.packageJson === "boolean" ? {} : opts.packageJson,
          )
          .then(() => {}),
      );
    }
    if (opts.tsconfigJson) {
      tasks.push(this.ensureTsConfig(root, { force }));
    }
    if (opts.biomeJson) {
      tasks.push(this.ensureBiomeConfig(root, { force, checkWorkspace }));
    }
    if (opts.editorconfig) {
      tasks.push(this.ensureEditorConfig(root, { force, checkWorkspace }));
    }
    if (opts.envExample) {
      tasks.push(this.ensureEnvExample(root, { force }));
    }
    if (opts.agentMd) {
      tasks.push(this.ensureAgentMd(root, { force }));
    }
    if (opts.vscodeSettings) {
      tasks.push(this.ensureVscodeSettings(root, { force, checkWorkspace }));
    }

    await Promise.all(tasks);
  }

  // ===========================================
  // Config Files
  // ===========================================

  public async ensureTsConfig(
    root: string,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    const exists = await this.existsInParents(root, "tsconfig.json");
    if (!opts.force && exists) {
      return;
    }
    await this.fs.writeFile(
      this.fs.join(root, "tsconfig.json"),
      tsconfigJson(),
    );
  }

  public async ensureBiomeConfig(
    root: string,
    opts: { force?: boolean; checkWorkspace?: boolean } = {},
  ): Promise<void> {
    if (
      !opts.force &&
      opts.checkWorkspace &&
      (await this.existsInParents(root, "biome.json"))
    ) {
      return;
    }
    await this.ensureFile(root, "biome.json", biomeJson(), opts.force);
  }

  public async ensureEditorConfig(
    root: string,
    opts: { force?: boolean; checkWorkspace?: boolean } = {},
  ): Promise<void> {
    if (
      !opts.force &&
      opts.checkWorkspace &&
      (await this.existsInParents(root, ".editorconfig"))
    ) {
      return;
    }
    await this.ensureFile(root, ".editorconfig", editorconfig(), opts.force);
  }

  /**
   * Write `.env.example`.
   *
   * Not tied to `ensureGitRepo` like `.gitignore` is: a project that already
   * has a `.git` still needs to be told that `APP_SECRET` exists.
   */
  public async ensureEnvExample(
    root: string,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    await this.ensureFile(root, ".env.example", envExample(), opts.force);
  }

  /**
   * Ensure `.vscode/settings.json` exists, pointing the editor's TypeScript
   * language server at the `typescript` copy embedded in `alepha`. Keeps the
   * IDE on the same compiler version as `alepha typecheck` — see
   * `vscodeSettingsJson`.
   */
  public async ensureVscodeSettings(
    root: string,
    opts: { force?: boolean; checkWorkspace?: boolean } = {},
  ): Promise<void> {
    if (
      !opts.force &&
      opts.checkWorkspace &&
      (await this.existsInParents(root, ".vscode"))
    ) {
      return;
    }
    const target = this.fs.join(root, ".vscode", "settings.json");
    if (!opts.force && (await this.fs.exists(target))) {
      return;
    }
    await this.fs.mkdir(this.fs.join(root, ".vscode"), { recursive: true });
    await this.fs.writeFile(target, vscodeSettingsJson());
  }

  /**
   * Ensure git repository is initialized with .gitignore.
   *
   * @returns true if git was initialized, false if already exists or git unavailable
   */
  public async ensureGitRepo(
    root: string,
    opts: { force?: boolean } = {},
  ): Promise<boolean> {
    const gitDir = this.fs.join(root, ".git");

    // Skip if .git already exists
    if (!opts.force && (await this.fs.exists(gitDir))) {
      return false;
    }

    // Check if git is available
    const hasGit = await this.utils.isInstalledAsync("git");
    if (!hasGit) {
      return false;
    }

    // Initialize git repository
    await this.utils.exec("git init", { root, global: true });

    // Write .gitignore
    await this.ensureFile(root, ".gitignore", gitignore(), opts.force);

    return true;
  }

  /**
   * Ensure AGENTS.md (cross-tool standard, canonical source) exists, with a
   * CLAUDE.md stub that imports it via Claude Code's `@` syntax. Single
   * source of truth, cross-platform, no symlink needed.
   */
  public async ensureAgentMd(
    root: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    await Promise.all([
      this.ensureFile(root, "AGENTS.md", agentMd(), options.force),
      this.ensureFile(root, "CLAUDE.md", "@AGENTS.md\n", options.force),
    ]);
  }

  /**
   * Ensure alepha.config.ts exists with documented options.
   */
  public async ensureAlephaConfig(
    root: string,
    opts: { force?: boolean; devtools?: boolean } = {},
  ): Promise<void> {
    await this.ensureFile(
      root,
      "alepha.config.ts",
      alephaConfigTs({ devtools: opts.devtools }),
      opts.force,
    );
  }

  // ===========================================
  // Minimal Project Structure
  // ===========================================

  /**
   * Ensure src/main.server.ts exists with correct module imports.
   */
  public async ensureMainServerTs(
    root: string,
    opts: { react?: boolean; force?: boolean } = {},
  ): Promise<void> {
    const srcDir = this.fs.join(root, "src");
    await this.fs.mkdir(srcDir, { recursive: true });
    await this.ensureFile(
      srcDir,
      "main.server.ts",
      mainServerTs({ react: opts.react }),
      opts.force,
    );
  }

  // ===========================================
  // API Project Structure
  // ===========================================

  /**
   * Ensure API module structure exists.
   *
   * Creates:
   * - src/api/index.ts (API module)
   * - src/api/controllers/HelloController.ts (example controller)
   */
  public async ensureApiProject(
    root: string,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    const appName = this.getAppName(root);

    // Create directories
    await this.fs.mkdir(this.fs.join(root, "src/api/controllers"), {
      recursive: true,
    });
    await this.fs.mkdir(this.fs.join(root, "src/api/schemas"), {
      recursive: true,
    });

    // Create files
    await this.ensureFile(
      root,
      "src/api/index.ts",
      apiIndexTs({ appName }),
      opts.force,
    );
    await this.ensureFile(
      root,
      "src/api/controllers/HelloController.ts",
      apiHelloControllerTs({ appName }),
      opts.force,
    );
    await this.ensureFile(
      root,
      "src/api/schemas/helloResponseSchema.ts",
      apiHelloResponseSchemaTs(),
      opts.force,
    );
  }

  // ===========================================
  // Web Project Structure
  // ===========================================

  /**
   * Ensure web/React project structure exists.
   *
   * Creates:
   * - src/main.browser.ts
   * - src/main.css
   * - vite.config.ts (Tailwind plugin)
   * - src/web/index.ts, src/web/AppRouter.ts, src/web/components/Home.tsx
   */
  public async ensureWebProject(
    root: string,
    opts: {
      force?: boolean;
    } = {},
  ): Promise<void> {
    const appName = this.getAppName(root);

    // Create directories
    await this.fs.mkdir(this.fs.join(root, "src/web/components"), {
      recursive: true,
    });

    // public/favicon.svg
    await this.fs.mkdir(this.fs.join(root, "public"), { recursive: true });
    await this.ensureFile(root, "public/favicon.svg", logoSvg, opts.force);

    // src/main.css
    await this.ensureFile(root, "src/main.css", mainCss(), opts.force);

    // vite.config.ts (Tailwind CSS plugin)
    await this.ensureFile(root, "vite.config.ts", viteConfigTs(), opts.force);

    // Web structure
    await this.ensureFile(
      root,
      "src/web/index.ts",
      webIndexTs({ appName }),
      opts.force,
    );
    await this.ensureFile(
      root,
      "src/web/AppRouter.ts",
      webAppRouterTs(),
      opts.force,
    );
    await this.ensureFile(
      root,
      "src/web/components/Home.tsx",
      webHomeComponentTsx(),
      opts.force,
    );
    await this.ensureFile(
      root,
      "src/main.browser.ts",
      mainBrowserTs(),
      opts.force,
    );
  }

  // ===========================================
  // Test Directory
  // ===========================================

  /**
   * Ensure test directory exists with a dummy test file + a self-contained
   * `vitest.config.ts`. Pinning `test.root` prevents Vitest from walking up
   * to a parent monorepo config (e.g. one that boots a Postgres container).
   */
  public async ensureTestDir(root: string): Promise<void> {
    const testDir = this.fs.join(root, "test");
    const dummyPath = this.fs.join(testDir, "dummy.spec.ts");
    const vitestConfigPath = this.fs.join(root, "vitest.config.ts");

    if (!(await this.fs.exists(vitestConfigPath))) {
      await this.fs.writeFile(vitestConfigPath, vitestConfigTs());
    }

    if (!(await this.fs.exists(testDir))) {
      await this.fs.mkdir(testDir, { recursive: true });
      await this.fs.writeFile(dummyPath, dummySpecTs());
      return;
    }

    const files = await this.fs.ls(testDir);
    if (files.length === 0) {
      await this.fs.writeFile(dummyPath, dummySpecTs());
    }
  }

  // ===========================================
  // Full Init Orchestration
  // ===========================================

  /**
   * Full project init — scaffolds files, installs deps, sets up PM and git.
   */
  async init({
    run,
    root,
    flags,
    args,
  }: {
    run: RunnerMethod;
    root: string;
    flags: {
      pm?: "yarn" | "npm" | "pnpm" | "bun";
      force?: boolean;
      "no-devtools"?: boolean;
    };
    args?: string;
  }) {
    // Whether the user named a target directory. Distinguishes
    // `alepha init my-app` (create a project there) from a bare
    // `alepha init` (fill in whatever is missing, right here).
    const explicitPath = !!args;

    if (!args) {
      // If the current directory doesn't look like an existing project
      // (no package.json), default to creating a `my-app/` subdirectory
      // rather than scaffolding into a random cwd.
      const hasPackageJson = await this.fs.exists(
        this.fs.join(root, "package.json"),
      );
      if (!hasPackageJson) {
        args = "my-app";
      }
    }

    if (args) {
      root = this.fs.join(root, args);
      await this.fs.mkdir(root, { force: true });
    }

    // Creating a project at a named path expects a clean slate, so refuse to
    // scaffold over someone else's files. A bare `alepha init` is the
    // fill-in-the-gaps mode and stays safe to run on an existing project —
    // `ensureFile` never overwrites without `--force`.
    if (explicitPath && !flags.force) {
      const files = await this.fs.ls(root);
      // Allow a directory that only has package.json (common for monorepo packages)
      const meaningful = files.filter((f) => f !== "package.json");
      if (meaningful.length > 0) {
        throw new AlephaError(
          `Target directory is not empty (${root}). Use --force to overwrite existing files.`,
        );
      }
    }

    // Detect workspace context (are we inside packages/ or apps/ of a monorepo?)
    const workspace = await this.pm.getWorkspaceContext(root);

    // Always emit both AGENTS.md and CLAUDE.md at project roots (skip for
    // monorepo sub-packages where agent files live at workspace root).
    const writeAgentMd = !workspace.isPackage;

    // Expo owns its own client runtime, so it is the one case where the web
    // module and its Tailwind pipeline are skipped. Everything else gets the
    // full shape unconditionally.
    const isExpo = await this.pm.hasExpo(root);
    const web = !isExpo;

    // Devtools is on by default for apps and never for workspace packages —
    // a library has no Vite dev shell for the overlay to attach to.
    const devtools = !flags["no-devtools"] && !workspace.isPackage;

    const force = !!flags.force;

    await run({
      name: "ensuring configuration files",
      handler: async () => {
        await this.ensureConfig(root, {
          force,
          packageJson: {
            react: web,
            tailwind: web,
            isPackage: workspace.isPackage,
            devtools,
          },
          tsconfigJson: !workspace.config.tsconfigJson,
          biomeJson: true,
          editorconfig: !workspace.config.editorconfig,
          // Same rule as the agent files: a project root owns its env, a
          // monorepo sub-package reads the workspace root's.
          envExample: writeAgentMd,
          agentMd: writeAgentMd,
          // Editor TS-server pointer at a project root only; monorepo
          // sub-packages inherit the workspace-root `.vscode/`.
          vscodeSettings: writeAgentMd,
        });

        // Create alepha.config.ts with documented options
        await this.ensureAlephaConfig(root, { force, devtools });

        // Every project gets the same structure
        await this.ensureMainServerTs(root, { react: web, force });
        await this.ensureApiProject(root, { force });
        if (web) {
          await this.ensureWebProject(root, { force });
        }
      },
    });

    // Use workspace PM if detected, otherwise detect from current root
    const pmName = await this.pm.getPackageManager(
      workspace.workspaceRoot ?? root,
      flags.pm ?? workspace.packageManager ?? undefined,
    );

    // Only setup PM files if not in a workspace package
    if (!workspace.isPackage) {
      if (pmName === "yarn") {
        await this.pm.ensureYarn(root);
        await run("yarn set version stable", { root });
      } else if (pmName === "bun") {
        await this.pm.ensureBun(root);
      } else if (pmName === "pnpm") {
        await this.pm.ensurePnpm(root);
      } else {
        await this.pm.ensureNpm(root);
      }
    }

    // Run install from workspace root if in a package, otherwise from current root
    const installRoot = workspace.workspaceRoot ?? root;
    await run(`${pmName} install`, {
      alias: `installing dependencies with ${pmName}`,
      root: installRoot,
    });

    // Always scaffold the test setup — Vitest ships embedded in `alepha`, so
    // `alepha test` works in every project. The dummy spec doubles as a
    // worked example for both humans and AI agents.
    await this.ensureTestDir(root);

    // Best-effort lint pass — don't block init if it fails. The user can
    // fix or silence issues later.
    try {
      await run(`${pmName} run lint`, {
        alias: "running linter",
        root,
      });
    } catch (err) {
      this.log.warn(
        "Linter reported issues during init — continuing. Run `lint` again later to inspect.",
        { error: err instanceof Error ? err.message : String(err) },
      );
    }

    // Initialize git repository if not in a workspace package
    if (!workspace.isPackage) {
      const gitInitialized = await this.ensureGitRepo(root, {
        force,
      });
      if (gitInitialized) {
        await run("git add .", {
          alias: "staging generated files",
          root,
        });
      }
    }

    // Don't show success message if no path arg, e.g. just "alepha init" to re-configure current dir
    if (!args) {
      return;
    }

    // We must end the run context in order to log success message
    run.end();

    // Success message
    const projectName = args || ".";
    const pmRun = pmName === "npm" ? "npm run" : pmName;
    const c = this.colors;

    this.log.info("");
    this.log.info(`  ${c.set("GREEN", "✓")} Project ready!`);
    this.log.info("");
    this.log.info(
      `  ${c.set("GREY_DARK", "$")} cd ${c.set("CYAN", projectName)}`,
    );
    this.log.info(
      `  ${c.set("GREY_DARK", "$")} ${c.set("CYAN", `${pmRun} dev`)}`,
    );

    this.log.info("");
  }

  // ===========================================
  // Helpers
  // ===========================================

  /**
   * Write a file, optionally overriding if it exists.
   */
  protected async ensureFile(
    root: string,
    relativePath: string,
    content: string,
    force?: boolean,
  ): Promise<void> {
    const fullPath = this.fs.join(root, relativePath);
    if (force || !(await this.fs.exists(fullPath))) {
      await this.fs.writeFile(fullPath, content);
    }
  }

  /**
   * Check if a file exists in the given directory or any parent directory.
   */
  protected async existsInParents(
    root: string,
    filename: string,
  ): Promise<boolean> {
    let current = root;
    while (true) {
      if (await this.fs.exists(this.fs.join(current, filename))) {
        return true;
      }
      const parent = dirname(current);
      if (parent === current) {
        // Reached filesystem root
        return false;
      }
      current = parent;
    }
  }
}
