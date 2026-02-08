import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { $inject, type Alepha, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import { importVite, importViteReact, viteAlephaSsrPreload } from "alepha/vite";
import type { Plugin, ViteDevServer } from "vite";
import { __alephaRef } from "../../core/helpers/ref.ts";
import { ConsoleColorProvider } from "../../logger/providers/ConsoleColorProvider.ts";
import type { AppEntry } from "./AppEntryProvider.ts";

export interface DevServerOptions {
  /**
   * Root directory of the project.
   */
  root: string;

  /**
   * Path to the server entry file.
   */
  entry: AppEntry;
}

/**
 * Vite development server with Alepha integration.
 *
 * Architecture:
 * - Vite owns the HTTP server
 * - Alepha handles requests via Vite plugin middleware
 * - Request flow: Vite built-in (HMR, assets) → Alepha routes
 *
 * HMR Strategy:
 * - Browser-only changes (CSS, client components) → Vite HMR (React Fast Refresh)
 * - Server-only changes → Reload Alepha → Full browser reload
 * - Shared changes → Reload Alepha → Let HMR propagate
 */
export class ViteDevServerProvider {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly colors = $inject(ConsoleColorProvider);

  protected server!: ViteDevServer;
  protected options!: DevServerOptions;
  protected alepha: Alepha | null = null;
  protected hasError = false;
  protected currentError: Error | null = null;
  protected changedFiles = new Set<string>();
  protected waitingForRetry = false;
  protected reloadDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  protected isReloading = false;
  protected needsBrowserReload = false;

  /**
   * Initialize the dev server and load Alepha.
   */
  public async init(options: DevServerOptions): Promise<Alepha> {
    this.options = options;
    await this.createServer();

    try {
      return await this.loadAlepha(true);
    } catch (err) {
      this.hasError = true;
      this.currentError = err instanceof Error ? err : new Error(String(err));
      this.logError("Startup failed", err);
      this.alepha = null;
      return await this.waitForSuccessfulLoad();
    }
  }

  /**
   * Start the Alepha server and begin listening.
   */
  public async start(): Promise<void> {
    try {
      await this.alepha?.start();
      await this.listen();

      console.log("");
      this.server.printUrls();
      this.server.bindCLIShortcuts({ print: true });
      console.log("");
    } catch (err) {
      this.hasError = true;
      this.currentError = err instanceof Error ? err : new Error(String(err));
      this.logError("Startup failed", err);
      this.alepha = null;
      this.alepha = await this.waitForSuccessfulLoad();
      await this.alepha.start();
      await this.listen();
    }
  }

  /**
   * Check if project uses React.
   */
  public hasReact(): boolean {
    try {
      this.alepha?.inject("ReactServerProvider");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create the Vite server with Alepha plugin.
   */
  protected async createServer(): Promise<void> {
    const { createServer, resolveConfig } = await importVite();
    const viteReact = await importViteReact();

    const plugins: Plugin[] = [];
    if (viteReact) plugins.push(viteReact());
    plugins.push(viteAlephaSsrPreload());
    plugins.push(this.createAlephaPlugin());

    // For now, port is "Alepha" specific, meaning we avoid the default Vite port (5173)
    let port: number;
    if (process.env.SERVER_PORT) {
      port = Number(process.env.SERVER_PORT);
    } else {
      const config = await resolveConfig({}, "serve", "development");
      port = config.server?.port ? Number(config.server.port) : 3000;
    }

    this.server = await createServer({
      root: this.options.root,
      plugins,
      appType: "custom",
      server: {
        port,
      },
      // customLogger: {
      //   info: () => {},
      //   warn: this.log.warn.bind(this.log),
      //   error: () => {}, // Suppress Vite errors, we handle them with better formatting
      //   warnOnce: this.log.warn.bind(this.log),
      //   clearScreen: () => {},
      //   hasWarned: false,
      //   hasErrorLogged: () => false,
      // },
    });

    this.patchServerRestartForEnvReload();
  }

  /**
   * Intercept Vite's server.restart() to handle .env file changes.
   * Vite calls restart() when .env files change.
   */
  protected patchServerRestartForEnvReload(): void {
    this.server.restart = async () => {
      if (this.waitingForRetry || this.isReloading) return;

      this.isReloading = true;

      console.log();
      console.log(this.colors.set("CYAN", "  ⟳ Reloading ..."));
      console.log();

      try {
        this.hasError = true; // Force full invalidation for env changes
        await this.loadAlepha(false);
        await this.alepha?.start();

        this.currentError = null;
        this.sendBrowserReload();
      } catch (err) {
        this.hasError = true;
        this.currentError = err instanceof Error ? err : new Error(String(err));
        this.logError("Reload failed", err);
        this.alepha = null;
        this.sendErrorOverlay(this.currentError);
      } finally {
        this.isReloading = false;
      }
    };
  }

  /**
   * Start listening for connections.
   */
  protected async listen(): Promise<void> {
    await this.server.listen();
  }

  /**
   * Vite plugin that integrates Alepha.
   */
  protected createAlephaPlugin(): Plugin {
    return {
      name: "alepha",

      configureServer: (server) => {
        // Devtools live reload via SSE
        server.middlewares.use(async (req, res, next) => {
          const url = req.url || "/";

          // Serve devtools HTML with reload script injected
          if (
            !url.startsWith("/__devtools") ||
            !req.headers.accept?.includes("text/html")
          ) {
            return next();
          }

          const indexPath = join(
            fileURLToPath(import.meta.url),
            "../../../../assets/devtools-ui/index.html",
          );

          try {
            let html = await readFile(indexPath, "utf-8");
            html = html.replace(
              "<head>",
              `<head><script type="module" src="/@vite/client"></script>`,
            );

            res.writeHead(200, { "content-type": "text/html" });
            res.end(html);
          } catch (err) {
            this.log.error("Failed to serve devtools UI", err);
            next();
          }
        });

        // Return function to run AFTER Vite's built-in middleware
        return () => {
          server.middlewares.use(async (req, res, next) => {
            // Skip Vite internal routes
            const url = req.url || "/";
            if (url.startsWith("/@") || url.startsWith("/__vite")) {
              next();
              return;
            }

            // In error state, let Vite serve its error overlay
            if (this.hasError && !this.alepha) {
              next();
              return;
            }

            // Emit to Alepha's request handler
            try {
              await this.alepha?.events.emit("node:request", { req, res });
            } catch (err) {
              this.log.error("Request handler error", err);
              if (!res.headersSent) {
                res.writeHead(500, { "content-type": "text/plain" });
                res.end("Internal Server Error");
              }
              return;
            }

            // If Alepha didn't handle it, pass to next (404 handled by Vite)
            if (!res.headersSent && !res.writableEnded) {
              next();
            }
          });
        };
      },

      handleHotUpdate: async (ctx) => {
        // Ignore IDE files
        if (/[/\\]\.idea[/\\]/.test(ctx.file)) return [];

        // Skip when waiting for startup retry
        if (this.waitingForRetry) return [];

        const firstModule = ctx.modules[0] as
          | { _ssrModule?: unknown; _clientModule?: unknown }
          | undefined;
        const isBrowserOnly = firstModule && !firstModule._ssrModule;

        // Browser-only: let Vite HMR handle it (React Fast Refresh)
        if (isBrowserOnly) return;

        // Queue Alepha reload for server-side invalidation
        this.changedFiles.add(ctx.file);

        // React components (.tsx/.jsx): restart Alepha silently,
        // let Vite HMR handle the browser update (React Fast Refresh)
        if (/\.(tsx|jsx)$/.test(ctx.file)) {
          this.scheduleReload();
          return;
        }

        // Pure server files: need full browser reload after Alepha restart
        this.needsBrowserReload = true;
        this.scheduleReload();
        return [];
      },
    };
  }

  /**
   * Send full browser reload via Vite's HMR.
   */
  protected sendBrowserReload(): void {
    // this.server.hot.send({
    //   type: "custom",
    //   event: "alepha:reload",
    //   data: {},
    // });
    this.server.hot.send({
      type: "full-reload",
    });
  }

  /**
   * Send error to Vite's native error overlay.
   */
  protected sendErrorOverlay(err: Error): void {
    this.fixStacktrace(err);
    this.server.hot.send({
      type: "error",
      err: {
        message: err.message,
        stack: err.stack ?? "",
        plugin: "alepha",
        id: this.options.entry.server,
      },
    });
  }

  /**
   * Schedule a debounced reload.
   * Batches rapid file changes into a single reload operation.
   */
  protected scheduleReload(): void {
    // Clear any pending reload
    if (this.reloadDebounceTimer) {
      clearTimeout(this.reloadDebounceTimer);
    }

    // If already reloading, the pending changes will be picked up
    // when the current reload checks changedFiles
    if (this.isReloading) {
      return;
    }

    this.reloadDebounceTimer = setTimeout(() => {
      this.reloadDebounceTimer = null;
      this.performReload();
    }, 100);
  }

  /**
   * Perform the actual reload after debounce.
   */
  protected async performReload(): Promise<void> {
    if (this.isReloading || this.changedFiles.size === 0) {
      return;
    }

    this.isReloading = true;

    // Snapshot files to process and clear immediately
    // New files arriving during reload will go to fresh set
    const filesToInvalidate = new Set(this.changedFiles);
    const sendReload = this.needsBrowserReload;
    this.changedFiles.clear();
    this.needsBrowserReload = false;

    console.log();
    console.log(this.colors.set("CYAN", "  ⟳ Reloading..."));
    console.log();

    try {
      await this.loadAlepha(false, filesToInvalidate);
      await this.alepha?.start();

      this.currentError = null;
      if (sendReload) {
        this.sendBrowserReload();
      }
    } catch (err) {
      this.hasError = true;
      this.currentError = err instanceof Error ? err : new Error(String(err));
      this.logError("Reload failed", err);
      this.alepha = null;
      this.sendErrorOverlay(this.currentError);
    } finally {
      this.isReloading = false;

      // If more files changed during reload, schedule another
      if (this.changedFiles.size > 0) {
        this.scheduleReload();
      }
    }
  }

  /**
   * Load or reload the Alepha instance.
   */
  protected async loadAlepha(
    isInitialLoad = false,
    filesToInvalidate?: Set<string>,
  ): Promise<Alepha> {
    await this.destroyAlepha();
    this.clearAlephaRefs();

    if (isInitialLoad || this.hasError) {
      this.server.moduleGraph.invalidateAll();
    } else {
      this.invalidateModulesWithImporters(filesToInvalidate ?? new Set());
    }

    // Snapshot and restore process.env to isolate each reload
    const envSnapshot = { ...process.env };
    await this.setupEnvironment();

    try {
      await this.server.ssrLoadModule(this.options.entry.server, {
        fixStacktrace: true,
      });
    } catch (err) {
      this.hasError = true;
      process.env = envSnapshot;
      throw err;
    }

    const alepha = this.getLoadedAlepha();

    // Expose Vite server to Alepha for Logger SSR stack trace fixing
    alepha.store.set("alepha.vite.server" as any, this.server);

    const mod = await this.server.ssrLoadModule("alepha/devtools");

    alepha.with(mod.AlephaDevtools);

    this.alepha = alepha;
    await this.setupAlepha();

    this.hasError = false;
    process.env = envSnapshot;

    return alepha;
  }

  /**
   * Setup Alepha instance with dev-specific configuration.
   */
  protected async setupAlepha(): Promise<void> {
    if (!this.alepha || !this.hasReact()) {
      return;
    }

    // Generate dev head content using Vite's transformIndexHtml
    const devHead = await this.generateDevHead();
    this.alepha.store.set("alepha.react.ssr.manifest" as any, { devHead });
  }

  /**
   * Generate dev head content by transforming HTML through Vite.
   */
  protected async generateDevHead(): Promise<string> {
    const { browser, style } = this.options.entry;

    const scripts: string[] = [];
    if (style) {
      scripts.push(`<link rel="stylesheet" href="/${style}">`);
    }
    if (browser) {
      scripts.push(`<script type="module" src="/${browser}"></script>`);
    }

    const minimalHtml = `<!DOCTYPE html><html><head>${scripts.join("\n")}</head><body></body></html>`;
    const transformed = await this.server.transformIndexHtml("/", minimalHtml);

    const headMatch = transformed.match(/<head>([\s\S]*?)<\/head>/i);
    return headMatch?.[1]?.trim() ?? "";
  }

  /**
   * Setup environment variables for dev mode.
   */
  protected async setupEnvironment(): Promise<void> {
    const { loadEnv } = await importVite();

    process.env.VITE_ALEPHA_DEV = "true";
    process.env.NODE_ENV ??= "development";

    const mode = process.env.NODE_ENV;
    const env = loadEnv(mode, this.options.root, "");

    // Merge into process.env (only set if not already defined)
    for (const [key, value] of Object.entries(env)) {
      process.env[key] ??= value;
    }

    const port = this.server.config.server.port ?? 3000;

    process.env.SERVER_PORT ??= `${port}`;
  }

  /**
   * Invalidate modules and all their importers.
   */
  protected invalidateModulesWithImporters(changedFiles: Set<string>): void {
    const invalidated = new Set<string>();
    const queue: string[] = [...changedFiles];

    while (queue.length > 0) {
      const file = queue.pop()!;
      if (invalidated.has(file)) continue;

      const mod = this.server.moduleGraph.getModuleById(file);
      if (!mod) continue;

      this.server.moduleGraph.invalidateModule(mod);
      invalidated.add(file);

      for (const importer of mod.importers) {
        if (importer.id && !invalidated.has(importer.id)) {
          queue.push(importer.id);
        }
      }
    }

    // Always invalidate entry module
    const entryPath = this.options.entry.server;
    const absoluteEntryPath = join(this.options.root, entryPath);
    const entryMod =
      this.server.moduleGraph.getModuleById(absoluteEntryPath) ??
      this.server.moduleGraph.getModuleById(entryPath) ??
      this.server.moduleGraph.getModuleById(`/${entryPath}`);
    if (entryMod) {
      this.server.moduleGraph.invalidateModule(entryMod);
    }
  }

  /**
   * Wait for file changes and retry loading until successful.
   */
  protected waitForSuccessfulLoad(): Promise<Alepha> {
    this.waitingForRetry = true;

    return new Promise((resolve) => {
      const onFileChange = async (file: string) => {
        if (/[/\\]\.idea[/\\]/.test(file)) return;

        console.log();
        console.log(this.colors.set("CYAN", "  ⟳ Retrying..."));

        const filesToInvalidate = new Set([file]);

        try {
          const alepha = await this.loadAlepha(false, filesToInvalidate);
          this.waitingForRetry = false;
          this.currentError = null;
          this.server.watcher.off("change", onFileChange);
          resolve(alepha);
        } catch (err) {
          this.hasError = true;
          this.currentError =
            err instanceof Error ? err : new Error(String(err));
          this.logError("Startup failed", err);
          this.alepha = null;
          this.sendErrorOverlay(this.currentError);
        }
      };

      this.server.watcher.on("change", onFileChange);
    });
  }

  /**
   * Clear global Alepha references before reload.
   */
  protected clearAlephaRefs(): void {
    __alephaRef.alepha = undefined;
    __alephaRef.service = undefined;
    __alephaRef.parent = undefined;
    (globalThis as any).__alepha = undefined;
  }

  /**
   * Destroy the current Alepha instance.
   */
  protected async destroyAlepha(): Promise<void> {
    if (this.alepha) {
      await this.alepha
        .destroy()
        .catch((err) => this.log.warn("Error destroying Alepha", err));
      this.alepha = null;
    }
  }

  /**
   * Get the loaded Alepha instance from globalThis.
   */
  protected getLoadedAlepha(): Alepha {
    const alepha: Alepha = (globalThis as any).__alepha;
    if (!alepha) {
      throw new AlephaError(
        "Alepha instance not found after loading entry module",
      );
    }
    return alepha;
  }

  /**
   * Fix stack trace using Vite's SSR stack trace fixer.
   */
  protected fixStacktrace(error: Error): void {
    this.server.ssrFixStacktrace(error);
  }

  /**
   * Log a formatted error with stack trace.
   */
  protected logError(title: string, err: unknown): void {
    const c = this.colors;

    console.log();
    console.log(c.set("RED", `  ✗ ${title}`));
    this.logErrorWithCause(err);
    console.log();
    console.log(c.set("GREY_DARK", "    Waiting for file changes to retry..."));
    console.log();
  }

  /**
   * Log error message and stack, recursively logging cause if present.
   */
  protected logErrorWithCause(err: unknown, depth = 0): void {
    const error = err instanceof Error ? err : new Error(String(err));
    const indent = `    ${"  ".repeat(depth)}`;

    this.fixStacktrace(error);

    const name = error.name || "Error";
    const message = error.message || "Unknown error";
    const stackLines = error.stack?.split("\n").slice(1);

    console.log();
    if (depth > 0) {
      console.log(this.colors.set("GREY_DARK", `${indent}Caused by:`));
    }
    console.log(this.colors.set("WHITE_BOLD", `${indent + name}: ${message}`));
    if (stackLines?.length) {
      console.log();
      for (const line of stackLines) {
        console.log(`${indent}${this.colors.set("GREY_DARK", line)}`);
      }
    }

    if (error.cause) {
      this.logErrorWithCause(error.cause, depth + 1);
    }
  }
}
