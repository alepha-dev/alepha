import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { $inject, $use, Alepha, t } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import { devOptions } from "../atoms/devOptions.ts";
import { AppEntryProvider } from "../providers/AppEntryProvider.ts";
import { ViteDevServerProvider } from "../providers/ViteDevServerProvider.ts";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { PackageManagerUtils } from "../services/PackageManagerUtils.ts";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";

export class DevCommand {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly scaffolder = $inject(ProjectScaffolder);
  protected readonly alepha = $inject(Alepha);
  protected readonly viteDevServer = $inject(ViteDevServerProvider);
  protected readonly boot = $inject(AppEntryProvider);
  protected readonly options = $use(devOptions);

  /**
   * Will run the project in watch mode.
   *
   * When run from a workspace root (with apps/ directory), spawns all apps in parallel.
   * When run from an app directory, starts a single Vite dev server.
   */
  public readonly dev = $command({
    name: "dev",
    mode: true,
    description: "Run the project in development mode",
    flags: t.object({
      only: t.optional(
        t.string({
          description:
            "Run only specific apps (comma-separated: --only api,companion)",
        }),
      ),
    }),
    handler: async ({ root, flags }) => {
      const apps = await this.discoverApps(root);

      if (apps.length > 0) {
        await this.runMultiple(root, apps, flags);
      } else {
        await this.runSingle(root);
      }
    },
  });

  /**
   * Discover apps in the workspace root.
   *
   * Looks for directories under apps/ that contain a package.json.
   * Supports scoped directories (e.g., apps/@passeo/api).
   * Returns empty array if not in a workspace root.
   */
  protected async discoverApps(
    root: string,
  ): Promise<Array<{ name: string; path: string }>> {
    const appsDir = join(root, "apps");

    if (!(await this.fs.exists(appsDir))) {
      return [];
    }

    const entries = await readdir(appsDir);
    const apps: Array<{ name: string; path: string }> = [];

    for (const entry of entries) {
      const appPath = join(appsDir, entry);
      const pkgPath = join(appPath, "package.json");

      if (await this.fs.exists(pkgPath)) {
        apps.push({ name: entry, path: appPath });
        continue;
      }

      // Check scoped directories (e.g., apps/@passeo/api)
      const entryStat = await stat(appPath).catch(() => null);
      if (entryStat?.isDirectory()) {
        const scopedEntries = await readdir(appPath);
        for (const scopedEntry of scopedEntries) {
          const scopedPath = join(appPath, scopedEntry);
          const scopedPkgPath = join(scopedPath, "package.json");

          if (await this.fs.exists(scopedPkgPath)) {
            apps.push({ name: scopedEntry, path: scopedPath });
          }
        }
      }
    }

    return apps;
  }

  /**
   * Run a single app (existing behavior).
   */
  protected async runSingle(root: string): Promise<void> {
    await this.scaffolder.ensureConfig(root, {
      tsconfigJson: true,
    });

    const entry = await this.boot.getAppEntry(root);
    this.log.debug("Entry file found", { entry });

    const options = this.options;

    await this.viteDevServer.init({
      root,
      entry,
      noDevtools: options.noDevtools ?? false,
      noViteReactPlugin: options.noViteReactPlugin ?? false,
    });

    await this.viteDevServer.start();
  }

  /**
   * Run multiple apps in parallel with colored prefixed output.
   */
  protected async runMultiple(
    _root: string,
    apps: Array<{ name: string; path: string }>,
    flags: Record<string, unknown>,
  ): Promise<void> {
    const only = flags.only as string | undefined;

    if (only) {
      const filter = only.split(",").map((s) => s.trim().toLowerCase());
      apps = apps.filter((app) => filter.includes(app.name.toLowerCase()));
    }

    if (apps.length === 0) {
      this.log.warn("No apps found to run");
      return;
    }

    this.log.debug(
      `Starting ${apps.length} apps: ${apps.map((a) => a.name).join(", ")}`,
    );

    const basePort = 5173;
    const processes = apps.map((app, i) => this.spawnApp(app, basePort + i));

    // Handle graceful shutdown
    const cleanup = () => {
      for (const proc of processes) {
        proc.kill("SIGTERM");
      }
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    // Wait for all processes (they run until killed)
    await Promise.allSettled(
      processes.map(
        (proc) =>
          new Promise<void>((resolve) => {
            proc.on("exit", () => resolve());
          }),
      ),
    );
  }

  /**
   * Spawn a single app process with inherited stdio.
   *
   * Each child process gets APP_NAME set, so the Alepha logger
   * handles prefixing automatically.
   */
  protected spawnApp(
    app: { name: string; path: string },
    port: number,
  ): ReturnType<typeof spawn> {
    const proc = spawn("yarn", ["alepha", "dev"], {
      cwd: app.path,
      stdio: "inherit",
      env: {
        ...process.env,
        APP_NAME: app.name.toUpperCase(),
        SERVER_PORT: String(port),
        FORCE_COLOR: "1",
      },
    });

    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        this.log.error(`${app.name} exited with code ${code}`);
      }
    });

    return proc;
  }
}
