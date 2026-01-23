import { basename, dirname } from "node:path";
import { $inject } from "alepha";
import { FileSystemProvider } from "alepha/file";
import { $logger } from "alepha/logger";
import { apiHelloControllerTs } from "../assets/apiHelloControllerTs.ts";
import { apiIndexTs } from "../assets/apiIndexTs.ts";
import { biomeJson } from "../assets/biomeJson.ts";
import { type ClaudeMdOptions, claudeMd } from "../assets/claudeMd.ts";
import { dummySpecTs } from "../assets/dummySpecTs.ts";
import { editorconfig } from "../assets/editorconfig.ts";
import { mainBrowserTs } from "../assets/mainBrowserTs.ts";
import { mainCss } from "../assets/mainCss.ts";
import { mainServerTs } from "../assets/mainServerTs.ts";
import { tsconfigJson } from "../assets/tsconfigJson.ts";
import { webAppRouterTs } from "../assets/webAppRouterTs.ts";
import { webHelloComponentTsx } from "../assets/webHelloComponentTsx.ts";
import { webIndexTs } from "../assets/webIndexTs.ts";
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
    const appName = dirName.toLowerCase().replace(/[\s\-_]/g, "");
    return appName || "app";
  }

  /**
   * Ensure all configuration files exist.
   */
  public async ensureConfig(
    root: string,
    opts: {
      force?: boolean;
      packageJson?: boolean | DependencyModes;
      tsconfigJson?: boolean;
      indexHtml?: boolean;
      biomeJson?: boolean;
      editorconfig?: boolean;
      claudeMd?: boolean | ClaudeMdOptions;
    },
  ): Promise<void> {
    const tasks: Promise<void>[] = [];
    const force = opts.force ?? false;

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
    if (opts.indexHtml) {
      tasks.push(this.ensureReactProject(root, { force }));
    }
    if (opts.biomeJson) {
      tasks.push(this.ensureBiomeConfig(root, { force }));
    }
    if (opts.editorconfig) {
      tasks.push(this.ensureEditorConfig(root, { force }));
    }
    if (opts.claudeMd) {
      tasks.push(
        this.ensureClaudeMd(
          root,
          typeof opts.claudeMd === "boolean"
            ? { force }
            : { ...opts.claudeMd, force },
        ),
      );
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
    opts: { force?: boolean } = {},
  ): Promise<void> {
    await this.ensureFile(root, "biome.json", biomeJson(), opts.force);
  }

  public async ensureEditorConfig(
    root: string,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    await this.ensureFile(root, ".editorconfig", editorconfig(), opts.force);
  }

  public async ensureClaudeMd(
    root: string,
    options: ClaudeMdOptions & { force?: boolean } = {},
  ): Promise<void> {
    await this.ensureFile(root, "CLAUDE.md", claudeMd(options), options.force);
  }

  // ===========================================
  // API Project Structure
  // ===========================================

  /**
   * Ensure src/main.server.ts exists with full API structure.
   *
   * Creates:
   * - src/main.server.ts (entry point)
   * - src/api/index.ts (API module)
   * - src/api/controllers/HelloController.ts (example controller)
   */
  public async ensureApiProject(
    root: string,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    const srcDir = this.fs.join(root, "src");

    // Don't overwrite existing content unless force is set
    if (!opts.force && (await this.fs.exists(srcDir))) {
      const files = await this.fs.ls(srcDir);
      if (files.length > 0) return;
    }

    const appName = this.getAppName(root);

    // Create directories
    await this.fs.mkdir(this.fs.join(root, "src/api/controllers"), {
      recursive: true,
    });

    // Create files
    await this.ensureFile(srcDir, "main.server.ts", mainServerTs(), opts.force);
    await this.ensureFile(
      srcDir,
      "api/index.ts",
      apiIndexTs({ appName }),
      opts.force,
    );
    await this.ensureFile(
      srcDir,
      "api/controllers/HelloController.ts",
      apiHelloControllerTs(),
      opts.force,
    );
  }

  // ===========================================
  // React Project Structure
  // ===========================================

  /**
   * Ensure full React project structure exists.
   *
   * Creates:
   * - src/main.server.ts, src/main.browser.ts
   * - src/api/index.ts, src/api/controllers/HelloController.ts
   * - src/web/index.ts, src/web/AppRouter.ts, src/web/components/Hello.tsx
   */
  public async ensureReactProject(
    root: string,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    const appName = this.getAppName(root);

    // Create directories
    await this.fs.mkdir(this.fs.join(root, "src/api/controllers"), {
      recursive: true,
    });
    await this.fs.mkdir(this.fs.join(root, "src/web/components"), {
      recursive: true,
    });

    // src/main.css
    await this.ensureFile(root, "src/main.css", mainCss(), opts.force);

    // API structure
    await this.ensureFile(
      root,
      "src/api/index.ts",
      apiIndexTs({ appName }),
      opts.force,
    );
    await this.ensureFile(
      root,
      "src/api/controllers/HelloController.ts",
      apiHelloControllerTs(),
      opts.force,
    );
    await this.ensureFile(
      root,
      "src/main.server.ts",
      mainServerTs({ react: true }),
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
      webAppRouterTs(),
      opts.force,
    );
    await this.ensureFile(
      root,
      "src/web/components/Hello.tsx",
      webHelloComponentTsx(),
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
