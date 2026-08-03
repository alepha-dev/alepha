import { join } from "node:path";
import { __alephaRef, $inject, type Alepha, AlephaError } from "alepha";
import { $logger, ConsoleColorProvider } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import type { Plugin, ViteDevServer } from "vite";
import { ViteUtils } from "../services/ViteUtils.ts";
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

  /**
   * Disable Vite React plugin.
   */
  noViteReactPlugin?: boolean;
}

/**
 * Hook called after Alepha is loaded during dev server init/reload.
 */
export type OnAlephaLoadedHook = (
  alepha: Alepha,
  server: ViteDevServer,
) => Promise<void>;

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
  protected readonly viteUtils = $inject(ViteUtils);

  protected server!: ViteDevServer;
  protected options!: DevServerOptions;
  public alepha: Alepha | null = null;
  protected hasError = false;
  protected currentError: Error | null = null;
  protected changedFiles = new Set<string>();
  protected waitingForRetry = false;
  protected reloadDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  protected isReloading = false;
  protected needsBrowserReload = false;
  protected currentReloadPromise: Promise<void> | null = null;
  protected extraVitePlugins: Plugin[] = [];
  protected alephaLoadedHooks: OnAlephaLoadedHook[] = [];

  /**
   * Register an additional Vite plugin.
   * Must be called before init().
   */
  public addVitePlugin(plugin: Plugin): void {
    this.extraVitePlugins.push(plugin);
  }

  /**
   * Register a hook called after Alepha is loaded/reloaded.
   */
  public onAlephaLoaded(hook: OnAlephaLoadedHook): void {
    this.alephaLoadedHooks.push(hook);
  }

  /**
   * Trigger a full Alepha reload programmatically.
   */
  public reload(): void {
    this.hasError = true;
    this.needsBrowserReload = true;
    this.changedFiles.add("__manual_reload__");
    this.scheduleReload();
  }

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

      const port = this.server.config.server.port ?? 5173;
      const url = `http://localhost:${port}/`;
      const log = this.alepha?.log ?? this.log;
      log.info(`Listening on ${this.colors.set("CYAN", url)}`);
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
    const { createServer, resolveConfig } = await this.viteUtils.importVite();
    const viteReact = await this.viteUtils.importViteReact();

    const plugins: Plugin[] = [];
    if (viteReact && !this.options.noViteReactPlugin) plugins.push(viteReact());
    plugins.push(this.viteUtils.createTsconfigPathsPlugin());
    plugins.push(this.viteUtils.createSsrPreloadPlugin());
    plugins.push(...this.extraVitePlugins);
    plugins.push(this.createAlephaPlugin());

    // DEFAULT PORT
    // Dev: 5173
    // Prod: 3000

    let port: number;
    if (process.env.SERVER_PORT) {
      port = Number(process.env.SERVER_PORT);
    } else {
      const config = await resolveConfig({}, "serve", "development");
      port = config.server?.port ? Number(config.server.port) : 5173;
    }

    this.server = await createServer({
      root: this.options.root,
      plugins,
      appType: "custom",
      resolve: {
        dedupe: [
          "react",
          "react-dom",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
        ],
      },
      server: {
        port,
      },
      optimizeDeps: {
        entries: [
          ...(this.options.entry.browser ? [this.options.entry.browser] : []),
        ],
      },
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
        // Re-send error overlay when a new browser connects (e.g. page refresh during error state)
        server.hot.on("connection", () => {
          if (this.currentError) {
            setTimeout(() => this.sendErrorOverlay(this.currentError!), 50);
          }
        });

        // Readiness endpoint: responds only when Alepha is fully loaded
        server.middlewares.use(async (req, res, next) => {
          if (req.url !== "/__alepha/ready") {
            next();
            return;
          }

          if (this.currentReloadPromise) {
            await this.currentReloadPromise;
          }

          if (this.alepha?.isReady()) {
            res.writeHead(200, { "content-type": "text/plain" });
            res.end("ok");
          } else {
            res.writeHead(503, { "content-type": "text/plain" });
            res.end("not ready");
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

            // Wait for in-progress reload to complete before serving
            if (this.currentReloadPromise) {
              await this.currentReloadPromise;
            }

            // In error state, serve a minimal HTML shell so the browser
            // can connect to Vite's HMR and display the error overlay
            if (this.hasError && !this.alepha) {
              if (req.headers.accept?.includes("text/html")) {
                res.writeHead(200, { "content-type": "text/html" });
                res.end(
                  '<!DOCTYPE html><html><head><script type="module" src="/@vite/client"></script></head><body></body></html>',
                );
                return;
              }
              // Everything that is not a browser page — an API call, a health
              // probe, curl — used to fall through to Vite and come back 404.
              // "Route not found" sends the caller looking for a routing bug
              // when the app simply does not compile; 500 says the server is
              // broken, which is the truth, and carries the reason with it.
              res.writeHead(500, { "content-type": "text/plain" });
              res.end(
                `Dev server has no app loaded — the last build failed.\n\n${
                  this.currentError?.stack ?? this.currentError?.message ?? ""
                }`,
              );
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

        // React component (.tsx/.jsx) edits always need the SSR module
        // graph invalidated — the `_ssrModule` shortcut below misses files
        // that are workspace-linked source-only (e.g. `@alepha/ui/...`).
        // Those don't carry an `_ssrModule` ref on `ctx.modules[0]` on
        // first edit and get classified as browser-only, leaving stale
        // SSR HTML and triggering hydration mismatches on next request.
        const isTsx = /\.(tsx|jsx)$/.test(ctx.file);
        if (!isTsx) {
          const firstModule = ctx.modules[0] as
            | { _ssrModule?: unknown; _clientModule?: unknown }
            | undefined;
          const isBrowserOnly = firstModule && !firstModule._ssrModule;

          // Browser-only: let Vite HMR handle it (React Fast Refresh)
          if (isBrowserOnly) return;
        }

        // Queue Alepha reload for server-side invalidation
        this.changedFiles.add(ctx.file);

        // React components (.tsx/.jsx): reload Alepha BEFORE letting
        // Vite HMR reach the browser, to prevent 503 errors from
        // components that fetch data on mount during server reload.
        if (/\.(tsx|jsx)$/.test(ctx.file)) {
          if (this.reloadDebounceTimer) {
            clearTimeout(this.reloadDebounceTimer);
            this.reloadDebounceTimer = null;
          }
          await this.performReload();
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
   * Uses a custom event so the client can poll for readiness before reloading.
   */
  protected sendBrowserReload(): void {
    this.server.hot.send("alepha:reload", {});
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
   * Perform the actual reload.
   * Returns a promise that callers can await to know when reload is done.
   * If a reload is already in progress, returns that promise.
   */
  protected performReload(): Promise<void> {
    if (this.changedFiles.size === 0) {
      return this.currentReloadPromise ?? Promise.resolve();
    }

    if (this.isReloading) {
      return this.currentReloadPromise ?? Promise.resolve();
    }

    this.currentReloadPromise = this.executeReload();
    return this.currentReloadPromise;
  }

  /**
   * Execute the reload work.
   */
  protected async executeReload(): Promise<void> {
    this.isReloading = true;

    // Snapshot files to process and clear immediately
    // New files arriving during reload will go to fresh set
    const filesToInvalidate = new Set(this.changedFiles);
    const sendReload = this.needsBrowserReload;
    const wasInError = this.hasError;
    this.changedFiles.clear();
    this.needsBrowserReload = false;

    console.log();
    console.log(this.colors.set("CYAN", "  ⟳ Reloading..."));
    console.log();

    try {
      await this.loadAlepha(false, filesToInvalidate);
      await this.alepha?.start();

      this.currentError = null;
      if (sendReload || wasInError) {
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
      this.currentReloadPromise = null;

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

    for (const hook of this.alephaLoadedHooks) {
      await hook(alepha, this.server);
    }

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

    const devHead = await this.generateDevHead();
    const favicon = await this.detectFavicon(join(this.options.root, "public"));
    this.alepha.store.set("alepha.react.ssr.manifest", { devHead, favicon });
  }

  /**
   * Detect a favicon file in the given directory.
   * Returns "mimeType:/path" if found, undefined otherwise.
   */
  protected async detectFavicon(
    publicDir: string,
  ): Promise<string | undefined> {
    const candidates: [string, string][] = [
      ["favicon.svg", "image/svg+xml"],
      ["favicon.png", "image/png"],
      ["favicon.ico", "image/x-icon"],
    ];
    for (const [file, mime] of candidates) {
      if (await this.fs.exists(join(publicDir, file))) {
        return `${mime}:/${file}`;
      }
    }
    return undefined;
  }

  /**
   * Generate dev head content for SSR.
   *
   * IMPORTANT: We call transformIndexHtml() on an EMPTY <head> (no script/link
   * tags) to collect plugin-injected preambles — specifically the React Fast
   * Refresh runtime from @vitejs/plugin-react. We then manually append our
   * own browser entry and stylesheet tags.
   *
   * Why not include <script>/<link> tags in the HTML passed to transformIndexHtml?
   * Because Vite would pre-transform the referenced browser entry module, which
   * walks the entire client module graph and triggers dep discovery. This creates
   * a race condition with Vite's background dep scanner: both find the same deps,
   * but the scanner commits a second optimization pass that replaces the first,
   * causing "504 Outdated Optimize Dep" errors on cold start.
   *
   * By passing empty HTML, we get the preamble without triggering the module
   * graph walk, leaving the scanner as the single dep discovery mechanism.
   */
  protected async generateDevHead(): Promise<string> {
    const { browser, style } = this.options.entry;

    // Get plugin preambles (React Fast Refresh, etc.) without triggering
    // client module graph walk — see JSDoc above for why this matters.
    const emptyHtml = "<!DOCTYPE html><html><head></head><body></body></html>";
    const transformed = await this.server.transformIndexHtml("/", emptyHtml);
    const headMatch = transformed.match(/<head>([\s\S]*?)<\/head>/i);
    const preamble = headMatch?.[1]?.trim() ?? "";

    const tags: string[] = [];
    if (preamble) {
      tags.push(preamble);
    }

    // Reload handler: polls /__alepha/ready before reloading to avoid
    // hitting the server while it's still restarting.
    tags.push(`<script type="module">
if (import.meta.hot) {
  import.meta.hot.on("alepha:reload", async () => {
    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch("/__alepha/ready");
        if (res.ok) { window.location.reload(); return; }
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    window.location.reload();
  });
}
</script>`);

    if (style) {
      tags.push(`<script type="module">import "/${style}";</script>`);
    }
    if (browser) {
      tags.push(`<script type="module" src="/${browser}"></script>`);
    }

    return tags.join("\n");
  }

  /**
   * Setup environment variables for dev mode.
   */
  protected async setupEnvironment(): Promise<void> {
    const { loadEnv } = await this.viteUtils.importVite();

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
   * Invalidate modules and all their importers, across both client and
   * SSR module graphs.
   *
   * Vite registers a file under multiple module ids (one per query
   * variant — e.g. `?v=…`, `?import` and the bare path), and `getModuleById`
   * only matches one. For workspace-linked source files (`@alepha/ui/...`)
   * the SSR-graph entry is keyed by the absolute path while the client
   * may use the package-qualified id. `getModulesByFile` returns every
   * variant Vite knows about for a given absolute path — invalidating
   * each catches both halves of the dual graph and prevents stale SSR
   * compiled exports from surviving across edits.
   */
  protected invalidateModulesWithImporters(changedFiles: Set<string>): void {
    const graph = this.server.moduleGraph;
    const invalidated = new Set<string>();
    const queue: string[] = [...changedFiles];

    while (queue.length > 0) {
      const file = queue.pop()!;
      if (invalidated.has(file)) continue;
      invalidated.add(file);

      const mods = new Set([
        ...(graph.getModulesByFile(file) ?? []),
        ...(graph.getModuleById(file) ? [graph.getModuleById(file)!] : []),
      ]);
      if (mods.size === 0) continue;

      for (const mod of mods) {
        graph.invalidateModule(mod);
        for (const importer of mod.importers) {
          const key = importer.file ?? importer.id;
          if (key && !invalidated.has(key)) {
            queue.push(key);
          }
        }
      }
    }

    // Always invalidate entry module
    const entryPath = this.options.entry.server;
    const absoluteEntryPath = join(this.options.root, entryPath);
    const entryMod =
      graph.getModuleById(absoluteEntryPath) ??
      graph.getModuleById(entryPath) ??
      graph.getModuleById(`/${entryPath}`);
    if (entryMod) {
      graph.invalidateModule(entryMod);
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
          this.server.watcher.off("add", onFileChange);
          this.sendBrowserReload();
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
      this.server.watcher.on("add", onFileChange);
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
