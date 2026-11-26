import { createServer as createNetServer } from "node:net";
import { join } from "node:path";

import {
  $hook,
  $inject,
  $store,
  type Alepha,
  AlephaError,
  type AlephaMeta,
} from "alepha";
import { CommandError, EnvUtils } from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import { __alephaRef } from "alepha/internal";
import { $logger, ConsoleColorProvider } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import type { Logger, Plugin, ViteDevServer } from "vite";

import { metaOptions } from "../atoms/metaOptions.ts";
import { McpViewPlugin } from "../services/McpViewPlugin.ts";
import { MetaResolver } from "../services/MetaResolver.ts";
import { ViteUtils } from "../services/ViteUtils.ts";
import type { AppEntry } from "./AppEntryProvider.ts";

export interface DevServerOptions {
  /**
   * Root directory of the project.
   */
  root: string;

  /**
   * The app's entry files: the server entry, and the browser entry and
   * stylesheet when it has them.
   */
  entry: AppEntry;

  /**
   * Disable Vite React plugin.
   */
  noViteReactPlugin?: boolean;

  /**
   * Port to bind, from `dev.port` in alepha.config.ts.
   */
  port?: number;

  /**
   * Interface to bind. Unset, Vite's default: localhost only. `0.0.0.0`
   * serves the LAN, which a phone needs (`alepha capacitor dev`).
   */
  host?: string;

  /**
   * The address announced in the startup log when `host` binds every
   * interface, e.g. the LAN IP a phone reaches the server on.
   */
  displayHost?: string;

  /**
   * Constants for the app's code, already encoded as source text
   * (`JSON.stringify(value)`). Applied to the server modules through Vite's
   * `define`, and to the browser as globals set before the entry runs: in
   * dev, Vite's `define` never reaches client modules.
   */
  define?: Record<string, string>;

  /**
   * Exit instead of waiting for an edit when the first boot fails.
   *
   * In a terminal a failed boot waits for the save that fixes it. Without one
   * (an agent's background task, CI, `> dev.log`) nobody is there to save, and
   * a process that stays alive without ever listening only makes the caller's
   * wait loop time out with no reason given. Reloads after a successful boot
   * keep retrying either way.
   */
  exitOnStartupError?: boolean;
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
  protected readonly envUtils = $inject(EnvUtils);
  protected readonly colors = $inject(ConsoleColorProvider);
  protected readonly viteUtils = $inject(ViteUtils);
  protected readonly mcpViewPlugin = $inject(McpViewPlugin);
  protected readonly metaResolver = $inject(MetaResolver);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly metaOverride = $store(metaOptions);

  /**
   * This dev session's build metadata, resolved once when the server starts.
   *
   * Held on the provider because it is needed twice, by two different
   * mechanisms: `define` covers the SSR side, and {@link generateDevHead}
   * has to hand the same record to the browser separately - see there for why.
   */
  protected devMeta?: AlephaMeta;

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
   * Stop the app with the CLI.
   *
   * Under `alepha dev` the app's `run()` installs no signal traps (Vite owns
   * the process), so a Ctrl+C stopped the CLI's container and left the app's
   * never stopped: its `stop` hooks, the inspector's run entry among them,
   * never ran.
   */
  protected readonly onStop = $hook({
    on: "stop",
    handler: async () => {
      await this.destroyAlepha();
      await this.removeStateFile();
    },
  });

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

    // Before Vite exists, never in `setupEnvironment`: Vite watches `.env` and
    // restarts on its creation, and a restart fired during the first load ran
    // a second `loadAlepha` that tore the first one down, so `listen()` was
    // never reached and a fresh clone's first `alepha dev` hung with its port
    // unbound.
    await this.envUtils.ensureEnvFile(this.options.root);

    await this.createServer();

    try {
      return await this.loadAlepha(true);
    } catch (err) {
      await this.onStartupError(err);
      return await this.waitForSuccessfulLoad();
    }
  }

  /**
   * Start the Alepha server and begin listening.
   *
   * The two halves fail differently, which is why they are no longer in one
   * `try`. An app that throws on start is a code problem: the retry loop
   * waits for the edit that fixes it, however many saves that takes, and that
   * is the whole point of `alepha dev`. A socket that will not bind is not
   * (the port stays taken however many files you save), and folding it into
   * the same loop left the command sitting there looking alive while serving
   * nothing at all.
   */
  public async start(): Promise<void> {
    while (true) {
      try {
        await this.alepha?.start();
        break;
      } catch (err) {
        await this.onStartupError(err);
        this.alepha = await this.waitForSuccessfulLoad();
      }
    }

    await this.listen();

    const port = this.server.config.server.port ?? 5173;
    const host =
      this.options.host && this.options.host !== "localhost"
        ? (this.options.displayHost ?? this.options.host)
        : "localhost";
    const url = `http://${host}:${port}/`;
    const log = this.alepha?.log ?? this.log;
    log.info(`Listening on ${this.colors.set("CYAN", url)}`);

    await this.writeStateFile({ status: "ready", url, port });
    // One plain line, never coloured nor prefixed, that a script or an agent
    // waits for instead of polling the port: `grep -m1 "alepha dev: ready"`.
    // A failed boot prints `alepha dev: failed reason=...` instead.
    console.log(`alepha dev: ready url=${url} pid=${process.pid}`);
  }

  /**
   * Where this dev server says what it is doing:
   * `node_modules/.alepha/dev.json`, beside the dev database.
   *
   * Holds `status` (`ready` or `failed`), `url`, `port`, `pid`, `reason` on a
   * failure, and `at`. A tool finds a running server, its port and the pid to
   * stop from it, without parsing the log. Removed when the server stops.
   */
  public get stateFile(): string {
    return join(this.options.root, "node_modules", ".alepha", "dev.json");
  }

  protected async writeStateFile(state: {
    status: "ready" | "failed";
    url?: string;
    port?: number;
    reason?: string;
  }): Promise<void> {
    try {
      await this.fs.mkdir(join(this.stateFile, ".."), { recursive: true });
      await this.fs.writeFile(
        this.stateFile,
        `${JSON.stringify(
          { ...state, pid: process.pid, at: this.dateTime.nowISOString() },
          null,
          2,
        )}\n`,
      );
    } catch (error) {
      this.log.debug("Could not write the dev state file", { error });
    }
  }

  protected async removeStateFile(): Promise<void> {
    if (!this.options) return;
    try {
      await this.fs.rm(this.stateFile, { force: true });
    } catch (error) {
      this.log.debug("Could not remove the dev state file", { error });
    }
  }

  /**
   * A port nothing listens on, for `SERVER_PORT=0`.
   *
   * Resolved before the app boots rather than left to the listen call, so the
   * app reads the port it is really served on (redirect URIs, absolute links)
   * instead of `0`.
   */
  protected findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const probe = createNetServer();
      probe.unref();
      probe.on("error", reject);
      probe.listen(0, () => {
        const address = probe.address();
        const port = typeof address === "object" && address ? address.port : 0;
        probe.close(() => resolve(port));
      });
    });
  }

  /**
   * Stop the app and close the Vite server: what a command that started the
   * dev server for a bounded task (`alepha capacitor dev`) does when it ends.
   */
  public async close(): Promise<void> {
    await this.alepha?.stop();
    await this.server?.close();
  }

  /**
   * Check if project uses React.
   */
  public hasReact(): boolean {
    try {
      this.alepha?.inject("alepha.react.ReactServerProvider");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create the Vite server with Alepha plugin.
   */
  protected async createServer(): Promise<void> {
    const { createServer, createLogger, resolveConfig } =
      await this.viteUtils.importVite();
    const viteReact = await this.viteUtils.importViteReact();

    const plugins: Plugin[] = [];
    if (viteReact && !this.options.noViteReactPlugin) plugins.push(viteReact());
    plugins.push(this.viteUtils.createTsconfigPathsPlugin());
    plugins.push(this.viteUtils.createSsrPreloadPlugin());
    plugins.push(this.viteUtils.createClientModulesPlugin());
    // MCP Apps views: each one's source on its tool, and the virtual entry
    // the dev shell loads from this server.
    plugins.push(this.mcpViewPlugin.annotate());
    plugins.push(...this.extraVitePlugins);
    plugins.push(this.createAlephaPlugin());

    // DEFAULT PORT
    // Dev: 5173
    // Prod: 3000
    //
    // `SERVER_PORT` wins so CI and one-off overrides keep working, then
    // `dev.port` from alepha.config.ts, then Vite's own config, then 5173.

    let port: number;
    if (process.env.SERVER_PORT) {
      port = Number(process.env.SERVER_PORT);
    } else if (this.options.port) {
      port = this.options.port;
    } else {
      const config = await resolveConfig({}, "serve", "development");
      port = config.server?.port ? Number(config.server.port) : 5173;
    }

    // `SERVER_PORT=0`: any free port, which the ready line and the state file
    // report. Two agents starting servers at once no longer pick by hand.
    if (port === 0) {
      port = await this.findFreePort();
      process.env.SERVER_PORT = String(port);
    }

    // The dev server's own build metadata. `dev: true` is what stops the
    // stamped date being read as a build that never happened, and the runtime
    // is whatever is actually interpreting this process.
    this.devMeta = await this.metaResolver.resolve({
      root: this.options.root,
      runtime: "Bun" in globalThis ? "bun" : "node",
      dev: true,
      override: this.metaOverride,
    });

    // `define` below only reaches modules Vite transforms. In a downstream app
    // `alepha` comes from node_modules, which Vite SSR externalizes, so the
    // core would read the no-build fallback: `/version` and `alepha.name`
    // would say "unknown" and "app". The SSR render runs in this process, so a
    // global binding reaches it, as it does for the prerender.
    this.metaResolver.install(this.devMeta);

    this.server = await createServer({
      root: this.options.root,
      plugins,
      customLogger: this.createViteLogger(createLogger),
      appType: "custom",
      // Without this, `alepha.meta` under `alepha dev` silently falls back to
      // the no-build record and `/version` reports name "unknown" - no error
      // anywhere, since the token is simply never substituted.
      define: {
        ...this.metaResolver.define(this.devMeta),
        ...this.options.define,
      },
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
        host: this.options.host,
        // The app owns its CORS policy (`alepha/server/cors`). Vite's own
        // middleware answered every preflight first, granting any localhost
        // origin and refusing `capacitor://localhost` and LAN origins
        // whatever the app had configured.
        cors: false,
        // Without this Vite silently takes the next free port, so a second
        // app in the same repository starts on 5174 and every URL pinned to
        // 5173 (devtools, OAuth redirect URIs) breaks with nothing in the
        // output naming the cause. Same reasoning as `playwright.port.ts`.
        strictPort: true,
        // The page's `console.error` / `console.warn` and its uncaught errors,
        // source-mapped, printed in this terminal. Vite turns it on by itself
        // only when it recognises a coding agent; a script or a CI job
        // writing the log to a file needs it as much, and has no browser
        // console to look at. In a terminal, Vite's default stands.
        forwardConsole: process.stdout.isTTY ? undefined : true,
      },
      optimizeDeps: {
        entries: this.options.entry.browser ? [this.options.entry.browser] : [],
      },
    });

    await this.startClientPluginContainer();
    this.patchServerRestartForEnvReload();
  }

  /**
   * Run the client plugin container's `buildStart` before anything is loaded
   * over SSR.
   *
   * `vite:css` keeps its CSS-modules cache in a closure it assigns only in
   * `buildStart`, and the plugin container filters that hook to the **client**
   * environment. Vite starts the client container from its own `initServer`,
   * which does not run until `listen()`, but {@link loadAlepha} calls
   * `ssrLoadModule` before that, and the SSR container's lazy self-start skips
   * `vite:css` under the same client-only filter. So the cache stayed
   * undefined, and any app whose *eager* server graph reached a `.module.css`
   * died on startup with `Cannot read properties of undefined (reading 'set')`.
   *
   * `apps/docs` is one: it uses a single entry for server and browser, so its
   * component tree is eager. An app that lazy-loads its routes never reaches a
   * CSS module during the SSR load and never saw this.
   *
   * The container guards `buildStart` behind its own `_started` flag, so
   * Vite's later call is a no-op rather than a second initialisation.
   */
  protected async startClientPluginContainer(): Promise<void> {
    await this.server.environments?.client?.pluginContainer?.buildStart();
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
   *
   * Anything thrown here reaches the dev command and ends it. `EADDRINUSE` is
   * the one worth naming: it is nearly always a second `alepha dev`, or an
   * `e2e` run that took the port, and the raw Node error says only "listen
   * EADDRINUSE" with no hint of which app or which port.
   */
  protected async listen(): Promise<void> {
    try {
      await this.server.listen();
    } catch (err) {
      const port = this.server.config?.server?.port ?? 5173;
      if ((err as { code?: string })?.code === "EADDRINUSE") {
        throw new AlephaError(
          `Port ${port} is already in use, so the dev server cannot start. ` +
            "Stop whatever holds it, or move this app: dev.port in alepha.config.ts, or SERVER_PORT.",
          { cause: err },
        );
      }
      throw err;
    }
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
              // Everything that is not a browser page (an API call, a health
              // probe, curl) used to fall through to Vite and come back 404.
              // "Route not found" sends the caller looking for a routing bug
              // when the app simply does not compile; 500 says the server is
              // broken, which is the truth, and carries the reason with it.
              res.writeHead(500, { "content-type": "text/plain" });
              res.end(
                `Dev server has no app loaded: the last build failed.\n\n${
                  this.currentError?.stack ?? this.currentError?.message ?? ""
                }`,
              );
              return;
            }

            // Emit to Alepha's request handler
            try {
              await this.alepha?.events.emit("node:request:before", {
                req,
                res,
              });
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
        // graph invalidated: the `_ssrModule` shortcut below misses files
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
      void this.performReload();
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
      try {
        await this.loadAlepha(false, filesToInvalidate);
        await this.alepha?.start();
      } catch (partialError) {
        // Only a PARTIAL reload can fail on a stale module graph, and when it
        // does the error names a symptom, never the cause. A file saved while
        // a reload is still loading lets Vite invalidate modules mid-load, so
        // a module file is evaluated twice: one `$module` then exists as two
        // classes, its services point at the second, the entry registered the
        // first, and the container registers the module again
        // (`TOO_LATE_SUBSTITUTION`, a circular dependency, ...). A full reload
        // cannot see that, so retry once with the whole graph before
        // reporting anything; an error in the app fails this retry too.
        if (wasInError) throw partialError;
        this.hasError = true;
        await this.loadAlepha(false);
        await this.alepha?.start();
      }

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

    // Snapshot and restore process.env to isolate each reload. Restored
    // however the load ends: a value left behind by a failed load would be
    // part of the next snapshot, and `??=` would keep it over an edited
    // `.env`.
    const envSnapshot = { ...process.env };

    try {
      await this.setupEnvironment();

      try {
        await this.server.ssrLoadModule(this.options.entry.server, {
          fixStacktrace: true,
        });
      } catch (err) {
        this.hasError = true;
        throw err;
      }

      const alepha = this.getLoadedAlepha();

      // Expose Vite server to Alepha for Logger SSR stack trace fixing
      alepha.store.set("alepha.vite.server", this.server);

      for (const hook of this.alephaLoadedHooks) {
        await hook(alepha, this.server);
      }

      this.alepha = alepha;
      await this.setupAlepha();

      this.hasError = false;

      return alepha;
    } finally {
      process.env = envSnapshot;
    }
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
   * tags) to collect plugin-injected preambles, specifically the React Fast
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
    // client module graph walk: see JSDoc above for why this matters.
    const emptyHtml = "<!DOCTYPE html><html><head></head><body></body></html>";
    const transformed = await this.server.transformIndexHtml("/", emptyHtml);
    const headMatch = transformed.match(/<head>([\s\S]*?)<\/head>/i);
    const preamble = headMatch?.[1]?.trim() ?? "";

    const tags: string[] = [];
    if (preamble) {
      tags.push(preamble);
    }

    // Hand the build metadata to the browser explicitly.
    //
    // ⚠️ NOT redundant with the `define` on the dev server's config. Vite's
    // define transform opens with `if (environment.config.consumer ===
    // "client") return`, so in dev a user `define` reaches the SSR modules and
    // never the client ones - measured, not assumed. Without this the browser
    // silently falls back to the no-build record and disagrees with its own
    // server about what is running.
    //
    // A classic script, not a module: module scripts are deferred, and this
    // has to have run before the entry below reads it. Assigning to
    // `globalThis` is what makes the plain `typeof __ALEPHA_META__` guard in
    // core see it, so nothing about the read has to know dev from production.
    if (this.devMeta) {
      const token = this.metaResolver
        .define(this.devMeta)
        .__ALEPHA_META__.replaceAll("<", "\\u003c");
      tags.push(`<script>globalThis.__ALEPHA_META__=${token};</script>`);
    }

    // The caller's constants, the same way and for the same reason.
    for (const [name, value] of Object.entries(this.options.define ?? {})) {
      tags.push(
        `<script>globalThis[${JSON.stringify(name)}]=${value.replaceAll("<", "\\u003c")};</script>`,
      );
    }

    // Reload handler: polls /__alepha/ready before reloading to avoid
    // hitting the server while it's still restarting.
    //
    // ⚠️ Its own hot context from `/@vite/client`, never `import.meta.hot`:
    // this script is inline in the SSR HTML and Vite never transforms it, so
    // `import.meta.hot` is undefined here and a listener guarded by it was
    // never registered. Every server-side reload then left the browser on the
    // old code until a manual refresh.
    tags.push(`<script type="module">
import { createHotContext } from "/@vite/client";
createHotContext("/@alepha/reload").on("alepha:reload", async () => {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch("/__alepha/ready");
      if (res.ok) { window.location.reload(); return; }
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  window.location.reload();
});
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
   * variant, e.g. `?v=…`, `?import` and the bare path), and `getModuleById`
   * only matches one. For workspace-linked source files (`@alepha/ui/...`)
   * the SSR-graph entry is keyed by the absolute path while the client
   * may use the package-qualified id. `getModulesByFile` returns every
   * variant Vite knows about for a given absolute path: invalidating
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
      // Files saved since the retry in flight started. A watcher fires once
      // per file, and a "save all" or a git checkout fires many within a few
      // milliseconds: without this they each began their own `loadAlepha`,
      // concurrently, on the same module graph.
      const queued = new Set<string>();
      let running = false;

      const onFileChange = async (file: string) => {
        if (/[/\\]\.idea[/\\]/.test(file)) return;

        queued.add(file);
        // Already retrying: this change joins the next round rather than
        // starting one of its own. At most one follow-up runs, however many
        // files arrive while the current attempt is busy.
        if (running) return;
        running = true;

        try {
          while (queued.size > 0) {
            const filesToInvalidate = new Set(queued);
            queued.clear();

            console.log();
            console.log(this.colors.set("CYAN", "  ⟳ Retrying..."));

            try {
              const alepha = await this.loadAlepha(false, filesToInvalidate);
              this.waitingForRetry = false;
              this.currentError = null;
              this.server.watcher.off("change", onFileChange);
              this.server.watcher.off("add", onFileChange);
              this.sendBrowserReload();
              resolve(alepha);
              return;
            } catch (err) {
              this.hasError = true;
              this.currentError =
                err instanceof Error ? err : new Error(String(err));
              this.logError("Startup failed", err);
              this.alepha = null;
              this.sendErrorOverlay(this.currentError);
            }
          }
        } finally {
          running = false;
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
   * The first boot failed: report it, then either wait for the fix or end the
   * command (see {@link DevServerOptions.exitOnStartupError}).
   */
  protected async onStartupError(err: unknown): Promise<void> {
    this.hasError = true;
    this.currentError = err instanceof Error ? err : new Error(String(err));
    this.alepha = null;

    const hint = await this.missingWorkspaceHint(err);
    const exit = !!this.options.exitOnStartupError;
    this.logError("Startup failed", err, { hint, retrying: !exit });
    await this.writeStateFile({
      status: "failed",
      reason: this.currentError.message,
    });

    if (exit) {
      // The watcher and the HTTP server would keep the process alive past the
      // exit code the CLI sets.
      await this.server?.close();
      throw new CommandError(
        `alepha dev: failed reason=${JSON.stringify(this.currentError.message)}`,
        { cause: err },
      );
    }
  }

  /**
   * Name a stale install when the module that failed to load is one of the
   * app's own workspace dependencies.
   *
   * A `workspace:` dependency added since the last install is the usual
   * cause: its folder exists, but nothing linked it into `node_modules`, and
   * Vite's "Cannot find module '@acme/core/api'" reads like a bad import.
   */
  protected async missingWorkspaceHint(
    err: unknown,
  ): Promise<string | undefined> {
    const message = err instanceof Error ? err.message : String(err);
    const specifier = /Cannot find (?:module|package) '([^']+)'/.exec(
      message,
    )?.[1];
    if (!specifier || specifier.startsWith(".") || specifier.startsWith("/")) {
      return undefined;
    }

    const parts = specifier.split("/");
    const name = specifier.startsWith("@")
      ? parts.slice(0, 2).join("/")
      : parts[0];

    try {
      const pkg = JSON.parse(
        await this.fs.readTextFile(join(this.options.root, "package.json")),
      );
      const range =
        pkg.dependencies?.[name] ??
        pkg.devDependencies?.[name] ??
        pkg.peerDependencies?.[name];
      if (typeof range !== "string" || !range.startsWith("workspace:")) {
        return undefined;
      }
    } catch {
      return undefined;
    }

    let dir = this.options.root;
    while (true) {
      if (await this.fs.exists(join(dir, "node_modules", name))) {
        return undefined;
      }
      const parent = join(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }

    return `${name} is a workspace dependency of this app but is not linked into node_modules: run the install again (yarn install, pnpm install, ...).`;
  }

  /**
   * Vite's logger, minus its copy of an SSR evaluation error.
   *
   * Vite logs "Error when evaluating SSR module" itself and then rethrows, and
   * every `ssrLoadModule` here reports what it catches, so each failed boot
   * printed the same stack twice.
   */
  protected createViteLogger(createLogger: () => Logger): Logger {
    const logger = createLogger();
    const error = logger.error.bind(logger);
    logger.error = (msg, options) => {
      if (msg.includes("Error when evaluating SSR module")) return;
      error(msg, options);
    };
    return logger;
  }

  /**
   * Log a formatted error with stack trace.
   */
  protected logError(
    title: string,
    err: unknown,
    options: { hint?: string; retrying?: boolean } = {},
  ): void {
    const c = this.colors;

    console.log();
    console.log(c.set("RED", `  ✗ ${title}`));
    this.logErrorWithCause(err);
    if (options.hint) {
      console.log();
      console.log(c.set("ORANGE", `    Hint: ${options.hint}`));
    }
    if (options.retrying ?? true) {
      console.log();
      console.log(
        c.set("GREY_DARK", "    Waiting for file changes to retry..."),
      );
    }
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
