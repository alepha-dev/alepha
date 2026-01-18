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
import { indexHtml } from "../assets/indexHtml.ts";
import { mainBrowserTs } from "../assets/mainBrowserTs.ts";
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
      packageJson?: boolean | DependencyModes;
      tsconfigJson?: boolean;
      indexHtml?: boolean;
      biomeJson?: boolean;
      editorconfig?: boolean;
      claudeMd?: boolean | ClaudeMdOptions;
    },
  ): Promise<void> {
    const tasks: Promise<void>[] = [];

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
      tasks.push(this.ensureTsConfig(root));
    }
    if (opts.indexHtml) {
      tasks.push(this.ensureReactProject(root));
    }
    if (opts.biomeJson) {
      tasks.push(this.ensureBiomeConfig(root));
    }
    if (opts.editorconfig) {
      tasks.push(this.ensureEditorConfig(root));
    }
    if (opts.claudeMd) {
      tasks.push(
        this.ensureClaudeMd(
          root,
          typeof opts.claudeMd === "boolean" ? {} : opts.claudeMd,
        ),
      );
    }

    await Promise.all(tasks);
  }

  // ===========================================
  // Config Files
  // ===========================================

  public async ensureTsConfig(root: string): Promise<void> {
    // Check if tsconfig.json exists in current or parent directories
    if (await this.existsInParents(root, "tsconfig.json")) {
      return;
    }
    await this.fs.writeFile(this.fs.join(root, "tsconfig.json"), tsconfigJson);
  }

  public async ensureBiomeConfig(root: string): Promise<void> {
    await this.ensureFileIfNotExists(root, "biome.json", biomeJson);
  }

  public async ensureEditorConfig(root: string): Promise<void> {
    await this.ensureFileIfNotExists(root, ".editorconfig", editorconfig);
  }

  public async ensureClaudeMd(
    root: string,
    options: ClaudeMdOptions = {},
  ): Promise<void> {
    const path = this.fs.join(root, "CLAUDE.md");
    if (!(await this.fs.exists(path))) {
      await this.fs.writeFile(path, claudeMd(options));
    }
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
  public async ensureApiProject(root: string): Promise<void> {
    const srcDir = this.fs.join(root, "src");

    // Don't overwrite existing content
    if (await this.fs.exists(srcDir)) {
      const files = await this.fs.ls(srcDir);
      if (files.length > 0) return;
    }

    const appName = this.getAppName(root);

    // Create directories
    await this.fs.mkdir(this.fs.join(root, "src/api/controllers"), {
      recursive: true,
    });

    // Create files
    await this.fs.writeFile(
      this.fs.join(srcDir, "main.server.ts"),
      mainServerTs(),
    );
    await this.fs.writeFile(
      this.fs.join(srcDir, "api/index.ts"),
      apiIndexTs({ appName }),
    );
    await this.fs.writeFile(
      this.fs.join(srcDir, "api/controllers/HelloController.ts"),
      apiHelloControllerTs(),
    );
  }

  // ===========================================
  // React Project Structure
  // ===========================================

  /**
   * Ensure full React project structure exists.
   *
   * Creates:
   * - index.html
   * - src/main.server.ts, src/main.browser.ts
   * - src/api/index.ts, src/api/controllers/HelloController.ts
   * - src/web/index.ts, src/web/AppRouter.ts, src/web/components/Hello.tsx
   */
  public async ensureReactProject(root: string): Promise<void> {
    if (await this.fs.exists(this.fs.join(root, "index.html"))) {
      return;
    }

    const appName = this.getAppName(root);

    // Create directories
    await this.fs.mkdir(this.fs.join(root, "src/api/controllers"), {
      recursive: true,
    });
    await this.fs.mkdir(this.fs.join(root, "src/web/components"), {
      recursive: true,
    });

    // index.html
    await this.fs.writeFile(
      this.fs.join(root, "index.html"),
      indexHtml("src/main.browser.ts"),
    );

    // API structure
    await this.ensureFileIfNotExists(
      root,
      "src/api/index.ts",
      apiIndexTs({ appName }),
    );
    await this.ensureFileIfNotExists(
      root,
      "src/api/controllers/HelloController.ts",
      apiHelloControllerTs(),
    );
    await this.ensureFileIfNotExists(
      root,
      "src/main.server.ts",
      mainServerTs({ react: true }),
    );

    // Web structure
    await this.ensureFileIfNotExists(
      root,
      "src/web/index.ts",
      webIndexTs({ appName }),
    );
    await this.ensureFileIfNotExists(
      root,
      "src/web/AppRouter.ts",
      webAppRouterTs(),
    );
    await this.ensureFileIfNotExists(
      root,
      "src/web/components/Hello.tsx",
      webHelloComponentTsx(),
    );
    await this.ensureFileIfNotExists(
      root,
      "src/main.browser.ts",
      mainBrowserTs(),
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

  protected async ensureFileIfNotExists(
    root: string,
    relativePath: string,
    content: string,
  ): Promise<void> {
    const fullPath = this.fs.join(root, relativePath);
    if (!(await this.fs.exists(fullPath))) {
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
