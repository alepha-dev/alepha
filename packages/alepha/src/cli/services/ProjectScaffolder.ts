import { basename, dirname } from "node:path";
import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import {
  type AgentMdOptions,
  type AgentMdType,
  agentMd,
} from "../templates/agentMd.ts";
import { apiAppSecurityTs } from "../templates/apiAppSecurityTs.ts";
import { apiHelloControllerTs } from "../templates/apiHelloControllerTs.ts";
import { apiIndexTs } from "../templates/apiIndexTs.ts";
import { biomeJson } from "../templates/biomeJson.ts";
import { dummySpecTs } from "../templates/dummySpecTs.ts";
import { editorconfig } from "../templates/editorconfig.ts";
import { gitignore } from "../templates/gitignore.ts";
import { mainBrowserTs } from "../templates/mainBrowserTs.ts";
import { mainCss } from "../templates/mainCss.ts";
import { mainServerTs } from "../templates/mainServerTs.ts";
import { tsconfigJson } from "../templates/tsconfigJson.ts";
import { webAppRouterTs } from "../templates/webAppRouterTs.ts";
import { webHelloComponentTsx } from "../templates/webHelloComponentTsx.ts";
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
 * - Example code (HelloController, Hello component)
 */
export class ProjectScaffolder {
  protected readonly log = $logger();
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
      agentMd?: false | (AgentMdOptions & { type: AgentMdType });
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
    if (opts.agentMd) {
      tasks.push(this.ensureAgentMd(root, { ...opts.agentMd, force }));
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
    // Check if tsconfig.json exists in current or parent directories
    if (!opts.force && (await this.existsInParents(root, "tsconfig.json"))) {
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

  public async ensureAgentMd(
    root: string,
    options: AgentMdOptions & { type: AgentMdType; force?: boolean },
  ): Promise<void> {
    const filename = options.type === "claude" ? "CLAUDE.md" : "AGENTS.md";
    await this.ensureFile(
      root,
      filename,
      agentMd(options.type, options),
      options.force,
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
    opts: { api?: boolean; react?: boolean; force?: boolean } = {},
  ): Promise<void> {
    const srcDir = this.fs.join(root, "src");
    await this.fs.mkdir(srcDir, { recursive: true });
    await this.ensureFile(
      srcDir,
      "main.server.ts",
      mainServerTs({ api: opts.api, react: opts.react }),
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
    opts: { auth?: boolean; force?: boolean } = {},
  ): Promise<void> {
    const appName = this.getAppName(root);

    // Create directories
    await this.fs.mkdir(this.fs.join(root, "src/api/controllers"), {
      recursive: true,
    });

    // Create files
    await this.ensureFile(
      root,
      "src/api/index.ts",
      apiIndexTs({ appName, auth: opts.auth }),
      opts.force,
    );
    await this.ensureFile(
      root,
      "src/api/controllers/HelloController.ts",
      apiHelloControllerTs(),
      opts.force,
    );

    // Create AppSecurity if auth is enabled
    if (opts.auth) {
      await this.ensureFile(
        root,
        "src/api/AppSecurity.ts",
        apiAppSecurityTs(),
        opts.force,
      );
    }
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
   * - src/web/index.ts, src/web/AppRouter.ts, src/web/components/Hello.tsx
   */
  public async ensureWebProject(
    root: string,
    opts: {
      api?: boolean;
      ui?: boolean;
      auth?: boolean;
      admin?: boolean;
      force?: boolean;
    } = {},
  ): Promise<void> {
    const appName = this.getAppName(root);

    // Create directories
    await this.fs.mkdir(this.fs.join(root, "src/web/components"), {
      recursive: true,
    });

    // src/main.css
    await this.ensureFile(
      root,
      "src/main.css",
      mainCss({ ui: opts.ui }),
      opts.force,
    );

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
      webAppRouterTs({
        api: opts.api,
        ui: opts.ui,
        auth: opts.auth,
        admin: opts.admin,
      }),
      opts.force,
    );
    await this.ensureFile(
      root,
      "src/web/components/Hello.tsx",
      webHelloComponentTsx({ auth: opts.auth }),
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
   * Ensure test directory exists with a dummy test file.
   */
  public async ensureTestDir(root: string): Promise<void> {
    const testDir = this.fs.join(root, "test");
    const dummyPath = this.fs.join(testDir, "dummy.spec.ts");

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
