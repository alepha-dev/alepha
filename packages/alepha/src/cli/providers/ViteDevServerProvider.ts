import { join } from "node:path";
import type { Alepha } from "alepha";
import { importVite, importViteReact, viteAlephaSsrPreload } from "alepha/vite";
import type { InlineConfig, Plugin, ViteDevServer } from "vite";
import { DevServerProvider } from "./DevServerProvider.ts";

/**
 * Vite development server with Alepha integration.
 */
export class ViteDevServerProvider extends DevServerProvider {
  protected server!: ViteDevServer;

  /**
   * Create the Vite server in middleware mode.
   */
  protected async createServer(): Promise<void> {
    const { createServer } = await importVite();
    const viteReact = await importViteReact();

    const plugins: Plugin[] = [];
    if (viteReact) plugins.push(viteReact());
    plugins.push(viteAlephaSsrPreload());
    plugins.push(this.createHmrPlugin());

    this.server = await createServer({
      root: this.options.root,
      plugins,
      server: { middlewareMode: true },
      appType: "custom",
      customLogger: {
        info: () => {},
        warn: this.log.warn.bind(this.log),
        error: () => {}, // Suppress Vite errors, we handle them with better formatting
        warnOnce: this.log.warn.bind(this.log),
        clearScreen: () => {},
        hasWarned: false,
        hasErrorLogged: () => false,
      },
    } satisfies InlineConfig);

    this.patchViteServerRestartForEnvReload();
  }

  protected patchViteServerRestartForEnvReload(): void {
    // Intercept .env changes (Vite calls restart() for .env files)
    this.server.restart = async () => {
      // Skip when waiting for startup retry
      if (this.waitingForRetry) return;

      console.log();
      console.log(this.colors.set("CYAN", "  ⟳ Reloading .env..."));
      const startTime = Date.now();
      try {
        this.hasError = true; // Force full invalidation for env changes
        await this.loadAlepha(false);

        await this.alepha?.start();

        console.log(
          this.colors.set("GREEN", `  ✓ Ready in ${Date.now() - startTime}ms`),
        );
        console.log();
        this.sendBrowserReload();
      } catch (err) {
        this.hasError = true;
        this.logError("Reload failed", err);
        this.alepha = null;
      }
    };
  }

  /**
   * Vite plugin to handle HMR for Alepha.
   */
  protected createHmrPlugin(): Plugin {
    return {
      name: "alepha-hmr",
      handleHotUpdate: async (ctx) => {
        if (/[/\\]\.idea[/\\]/.test(ctx.file)) return [];

        // Skip HMR when waiting for startup retry (handled by waitForSuccessfulLoad)
        if (this.waitingForRetry) return [];

        const firstModule = ctx.modules[0] as any;
        const isBrowserOnly = firstModule && !firstModule._ssrModule;
        const isServerOnly = firstModule && !firstModule._clientModule;

        // Browser-only: let Vite HMR handle it (React Fast Refresh)
        if (isBrowserOnly) return;

        // Server or shared change: restart Alepha
        console.log();
        console.log(this.colors.set("CYAN", "  ⟳ Reloading..."));
        console.log();
        const startTime = Date.now();

        try {
          this.changedFiles.add(ctx.file);

          await this.loadAlepha(false);

          await this.alepha?.start();
          // console.log(
          //   this.colors.set(
          //     "GREEN",
          //     `  ✓ Ready in ${Date.now() - startTime}ms`,
          //   ),
          // );
          // console.log();

          // Server-only: full browser reload
          if (isServerOnly) {
            this.sendBrowserReload();
            return [];
          }

          // Shared: let HMR propagate to browser
          return;
        } catch (err) {
          this.hasError = true;
          this.logError("Reload failed", err);
          this.alepha = null;

          this.renderErrorOverlay(err as Error);

          return [];
        }
      },
    };
  }

  /**
   * Send browser reload signal via custom event.
   * Browser listens for 'alepha:reload' and does window.location.reload()
   */
  protected sendBrowserReload(): void {
    this.server.ws.send({
      type: "custom",
      event: "alepha:reload",
      data: {},
    });
  }

  /**
   * Fix stack trace using Vite's SSR stack trace fixer.
   */
  protected fixStacktrace(error: Error): void {
    this.server.ssrFixStacktrace(error);
  }

  /**
   * Subscribe to file changes via Vite's watcher.
   */
  protected subscribeToFileChanges(
    onChange: (file: string) => void,
  ): () => void {
    const watcher = this.server.watcher;
    watcher.on("change", onChange);
    return () => watcher.off("change", onChange);
  }

  /**
   * Run Vite middleware for a request.
   */
  protected runMiddleware(req: any, res: any, next: () => void): void {
    this.server.middlewares(req, res, next);
  }

  /**
   * Setup environment variables for dev mode.
   */
  protected async setupEnvironment(): Promise<void> {
    const { loadEnv } = await importVite();
    const mode = process.env.NODE_ENV || "development";
    const env = loadEnv(mode, this.options.root, "");

    // Merge into process.env (only set if not already defined)
    for (const [key, value] of Object.entries(env)) {
      process.env[key] ??= value;
    }

    this.setupDevEnvironment();
  }

  /**
   * Load or reload the Alepha instance.
   */
  protected async loadAlepha(isInitialLoad = false): Promise<Alepha> {
    await this.destroyAlepha();
    this.clearAlephaRefs();

    if (isInitialLoad || this.hasError) {
      this.server.moduleGraph.invalidateAll();
    } else {
      this.invalidateModulesWithImporters();
    }
    this.changedFiles.clear();

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

    // expose Vite server to Alepha for Logger SSR Fix stack traces
    alepha.store.set("alepha.vite.server" as any, this.server);
    if (this.nodeServer) {
      alepha.store.set("alepha.node.server", this.nodeServer);
    }

    this.alepha = alepha;
    await this.setupAlepha();

    this.hasError = false;
    process.env = envSnapshot;

    return alepha;
  }

  /**
   * Setup Alepha instance with Vite middleware.
   */
  protected async setupAlepha(): Promise<void> {
    if (!this.alepha || !this.hasReact()) {
      return;
    }

    // Generate dev head content using Vite's transformIndexHtml
    // This lets Vite and all plugins (React, etc.) inject their scripts
    const devHead = await this.generateDevHead();
    this.alepha.store.set("alepha.react.ssr.manifest" as any, { devHead });

    this.alepha.events.on("server:onRequest", {
      priority: "first",
      callback: async ({ request }) => {
        const node = request.raw.node;
        if (!node || this.isPageRequest(node.req)) return;

        const handled = await this.runViteMiddleware(
          node.req,
          node.res,
          request,
        );
        if (handled) {
          request.reply.status = node.res.statusCode || 200;
          request.reply.body = null;
        }
      },
    });
  }

  /**
   * Generate dev head content by transforming a minimal HTML through Vite.
   * This lets Vite and all plugins inject their scripts (HMR client, React Fast Refresh, etc.).
   */
  protected async generateDevHead(): Promise<string> {
    const { browser, style } = this.options.entry;

    // Build minimal HTML with entry points
    const scripts: string[] = [];
    if (style) {
      scripts.push(`<link rel="stylesheet" href="/${style}">`);
    }
    if (browser) {
      scripts.push(`<script type="module" src="/${browser}"></script>`);
    }

    const minimalHtml = `<!DOCTYPE html><html><head>${scripts.join("\n")}</head><body></body></html>`;

    // Transform through Vite to inject all plugin scripts
    const transformed = await this.server.transformIndexHtml("/", minimalHtml);

    // Extract head content
    const headMatch = transformed.match(/<head>([\s\S]*?)<\/head>/i);
    return headMatch?.[1]?.trim() ?? "";
  }

  /**
   * Run Vite middleware and detect if it handled the request.
   */
  protected async runViteMiddleware(
    req: any,
    res: any,
    ctx: { metadata: any },
  ): Promise<boolean> {
    // Skip if response already started
    if (res.headersSent || res.writableEnded) {
      return false;
    }

    return new Promise((resolve) => {
      let resolved = false;

      const done = (handled: boolean) => {
        if (resolved) return;
        resolved = true;
        if (handled) ctx.metadata.vite = true;
        resolve(handled);
      };

      // Wrap response to prevent writes after we've resolved
      const originalSetHeader = res.setHeader.bind(res);
      const originalWriteHead = res.writeHead?.bind(res);
      const originalWrite = res.write.bind(res);
      const originalEnd = res.end.bind(res);

      const guardedCall = <T>(fn: (...args: any[]) => T, ...args: any[]): T => {
        if (resolved && ctx.metadata.vite) {
          // Vite already handled this request, ignore late writes from framework
          return undefined as T;
        }
        return fn(...args);
      };

      res.setHeader = (...args: any[]) =>
        guardedCall(originalSetHeader, ...args);
      if (originalWriteHead) {
        res.writeHead = (...args: any[]) =>
          guardedCall(originalWriteHead, ...args);
      }
      res.write = (...args: any[]) => guardedCall(originalWrite, ...args);
      res.end = (...args: any[]) => guardedCall(originalEnd, ...args);

      res.on("finish", () => done(true));
      res.on("close", () => res.headersSent && done(true));

      this.server.middlewares(req, res, () => done(false));

      // Check after microtask if Vite started writing (for async handlers)
      setImmediate(() => {
        if (res.headersSent || res.writableEnded) {
          done(true);
        }
      });
    });
  }

  /**
   * Invalidate modules and all their importers.
   */
  protected invalidateModulesWithImporters(): void {
    const invalidated = new Set<string>();
    const queue: string[] = [...this.changedFiles];

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

    // Always invalidate entry module to ensure __alepha is set on reload
    // This prevents race conditions where the entry doesn't re-execute
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
}
