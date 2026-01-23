import { $inject, type Alepha, AlephaError } from "alepha";
import { FileSystemProvider } from "alepha/file";
import { $logger } from "alepha/logger";
import { importVite, importViteReact, viteAlephaSsrPreload } from "alepha/vite";
import type { InlineConfig, Plugin, ViteDevServer } from "vite";
import type { AppEntry } from "./AppEntryProvider.ts";
import { ViteTemplateProvider } from "./ViteTemplateProvider.ts";

export interface ViteDevServerOptions {
  /**
   * Root directory of the project.
   */
  root: string;

  /**
   * Path to the server entry file.
   */
  entry: AppEntry;

  /**
   * Port to run the dev server on.
   */
  port?: number;

  /**
   * Host to bind the dev server to.
   */
  host?: string | boolean;
}

/**
 * Vite development server with Alepha integration.
 *
 * Architecture:
 * - Vite runs in middleware mode (no HTTP server)
 * - Alepha is the HTTP server via server:onRequest event
 * - Request flow: Page requests → Alepha SSR, Assets → Vite middleware
 *
 * HMR Strategy:
 * - Browser-only changes (CSS, client components) → Vite HMR (React Fast Refresh)
 * - Server-only changes → Restart Alepha → Full browser reload
 * - Shared changes → Restart Alepha → Let Vite HMR propagate
 *
 * Features:
 * - Automatic .env reload detection
 * - Error recovery on next file change
 * - Optimized module invalidation (only changed files + importers)
 */
export class ViteDevServerProvider {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly templateProvider = $inject(ViteTemplateProvider);
  protected server!: ViteDevServer;
  protected options!: ViteDevServerOptions;
  protected alepha: Alepha | null = null;
  protected hasError = false;
  protected changedFiles = new Set<string>();

  public async init(options: ViteDevServerOptions): Promise<Alepha> {
    this.options = options;
    await this.createViteServer();
    return await this.loadAlepha(true);
  }

  public async start(): Promise<void> {
    await this.alepha?.start();
  }

  /**
   * Create the Vite server in middleware mode.
   */
  protected async createViteServer(): Promise<void> {
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
        error: this.log.error.bind(this.log),
        warnOnce: this.log.warn.bind(this.log),
        clearScreen: () => {},
        hasWarned: false,
        hasErrorLogged: () => false,
      },
    } satisfies InlineConfig);

    // Intercept .env changes (Vite calls restart() for .env files)
    this.server.restart = async () => {
      const startTime = Date.now();
      try {
        this.hasError = true; // Force full invalidation for env changes
        await this.loadAlepha(false);
        await this.alepha?.start();
        this.log.debug(`Env reloaded in ${Date.now() - startTime}ms`);
        this.sendBrowserReload();
      } catch (err) {
        this.hasError = true;
        this.log.error("Reload failed", err);
        this.log.warn("Waiting for file changes to retry...");
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
        if (ctx.file.includes("/.idea/")) return [];

        const firstModule = ctx.modules[0] as any;
        const isBrowserOnly = firstModule && !firstModule._ssrModule;
        const isServerOnly = firstModule && !firstModule._clientModule;

        // Browser-only: let Vite HMR handle it (React Fast Refresh)
        if (isBrowserOnly) return;

        // Server or shared change: restart Alepha
        const startTime = Date.now();

        try {
          this.changedFiles.add(ctx.file);
          await this.loadAlepha(false);
          await this.alepha?.start();
          this.log.debug(`Reloaded in ${Date.now() - startTime}ms`);

          // Server-only: full browser reload
          if (isServerOnly) {
            this.sendBrowserReload();
            return [];
          }

          // Shared: let HMR propagate to browser
          return;
        } catch (err) {
          this.hasError = true;
          this.log.error("Reload failed", err);
          this.log.warn("Waiting for file changes to retry...");
          this.alepha = null;
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
   * Setup environment variables for dev mode.
   */
  protected async setupEnvironment(): Promise<void> {
    const { loadEnv } = await importVite();
    const mode = process.env.NODE_ENV || "development";
    const env = loadEnv(mode, this.options.root, "");

    process.env.NODE_ENV ??= "development";
    process.env.VITE_ALEPHA_DEV = "true";
    process.env.SERVER_HOST ??= this.options.host?.toString() ?? "localhost";
    process.env.SERVER_PORT ??= String(
      this.options.port ??
        (process.env.SERVER_PORT ? Number(process.env.SERVER_PORT) : 3000),
    );

    // Merge into process.env (only set if not already defined)
    for (const [key, value] of Object.entries(env)) {
      process.env[key] ??= value;
    }
  }

  /**
   * Load or reload the Alepha instance.
   */
  protected async loadAlepha(isInitialLoad = false): Promise<Alepha> {
    if (this.alepha) {
      await this.alepha
        .stop()
        .catch((err) => this.log.warn("Error stopping Alepha", err));
      this.alepha = null;
    }

    if (isInitialLoad || this.hasError) {
      this.server.moduleGraph.invalidateAll();
    } else {
      this.invalidateModulesWithImporters();
    }
    this.changedFiles.clear();

    // Snapshot and restore process.env to isolate each reload
    const envSnapshot = { ...process.env };
    await this.setupEnvironment();

    await this.server.ssrLoadModule(this.options.entry.server);

    const alepha: Alepha = (globalThis as any).__alepha;
    if (!alepha) {
      throw new AlephaError(
        "Alepha instance not found after loading entry module",
      );
    }

    this.alepha = alepha;
    await this.setupAlepha();

    this.hasError = false;
    process.env = envSnapshot;

    return alepha;
  }

  public hasReact(): boolean {
    try {
      this.alepha?.inject("ReactServerProvider");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Setup Alepha instance with Vite middleware and template.
   */
  protected async setupAlepha(): Promise<void> {
    if (!this.alepha || !this.hasReact()) {
      return;
    }

    const template = await this.server.transformIndexHtml(
      "/",
      this.templateProvider.generateIndexHtml(this.options.entry),
    );

    this.alepha.store.set("alepha.react.server.template", template);

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
   * Check if request is for an HTML page (not an asset).
   */
  protected isPageRequest(req: any): boolean {
    const url = req.url || "/";

    // Root and index.html are page requests
    if (url === "/" || url === "/index.html") return true;

    // Vite internal routes
    if (url.startsWith("/@") || url.startsWith("/__vite")) return false;

    // Files with extensions are assets
    if (/\.\w+$/.test(url.split("?")[0])) return false;

    return true;
  }

  /**
   * Run Vite middleware and detect if it handled the request.
   */
  protected async runViteMiddleware(
    req: any,
    res: any,
    ctx: { metadata: any },
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let resolved = false;

      const done = (handled: boolean) => {
        if (resolved) return;
        resolved = true;
        if (handled) ctx.metadata.vite = true;
        resolve(handled);
      };

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
  }
}
