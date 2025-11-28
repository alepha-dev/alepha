import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Alepha, State } from "alepha";
import type { ResolvedConfig, ViteDevServer } from "vite";
import { importVite } from "../helpers/importVite.ts";

export interface AlephaRunnerOptions {
  /**
   * Path to the server entry file.
   */
  entry: string;

  /**
   * Enable debug logging.
   */
  debug?: boolean;
}

export interface AlephaRunnerState {
  root: string;
  started: boolean;
  app?: Alepha;
  config?: ResolvedConfig;
  lock?: PromiseWithResolvers<void>;
  log: (...msg: string[]) => void;
  entry: string;
  onReload?: () => void;
}

/**
 * Create an Alepha runner for development.
 *
 * The runner manages the lifecycle of an Alepha application during
 * Vite dev server operation, handling start/stop/restart and HMR.
 */
export function createAlephaRunner(opts: AlephaRunnerOptions): AlephaRunner {
  const state: AlephaRunnerState = {
    root: process.cwd().replace(/\\/g, "/"),
    started: false,
    log: opts.debug ? (...msg: string[]) => console.log(...msg) : () => {},
    entry: opts.entry,
    onReload: () => {},
  };

  return new AlephaRunner(state);
}

export class AlephaRunner {
  protected state: AlephaRunnerState;

  constructor(state: AlephaRunnerState) {
    this.state = state;
  }

  /**
   * Set resolved Vite config.
   */
  setConfig(config: ResolvedConfig): void {
    this.state.config = config;
  }

  /**
   * Check if SSR is enabled for the running app.
   */
  isSsrEnabled(): boolean {
    if (!this.state.app) return false;
    return (
      (this.state.app.state.get("alepha.react.server.ssr" as keyof State) as
        | boolean
        | undefined) ?? false
    );
  }

  /**
   * Check if app is started.
   */
  get isStarted(): boolean {
    return this.state.started;
  }

  /**
   * Get the running Alepha app instance.
   */
  get app(): Alepha | undefined {
    return this.state.app;
  }

  /**
   * Start the Alepha application.
   */
  async start(server: ViteDevServer): Promise<void> {
    const { loadEnv } = await importVite();

    if (this.state.started) {
      await this.restart(server, true);
      return;
    }

    if (!this.state.config) {
      this.state.log("[DEBUG] No config - skip starting");
      return;
    }

    this.state.onReload?.();

    this.state.log("[DEBUG] Starting Alepha app...");

    this.state.started = false;
    this.state.app = undefined;

    const serverEntryPath = path.resolve(
      this.state.config.root,
      this.state.entry,
    );
    const fileUrl = pathToFileURL(`${serverEntryPath}`).href;
    const env = loadEnv("development", this.state.config.root, "");
    const before = { ...process.env };

    for (const key in env) {
      process.env[key] = env[key];
    }

    process.env.NODE_ENV ??= "development";
    process.env.VITE_ALEPHA_DEV = "true";
    process.env.SERVER_HOST ??=
      typeof server.config.server.host === "string"
        ? server.config.server.host
        : "localhost";
    process.env.SERVER_PORT ??= String(server.config.server.port || "5173");

    try {
      const now = Date.now();
      await server.ssrLoadModule(fileUrl);
      this.state.log(`[DEBUG] Alepha app loaded in ${Date.now() - now}ms`);
      await new Promise((r) => setTimeout(r, 10));

      this.state.app = (globalThis as any).__alepha;
      if (!this.state.app) {
        this.state.log("[DEBUG] No app found - skip starting");
        return;
      }

      this.state.app.state.set("alepha.node.server" as any, server.httpServer);

      await this.state.app.start();
      this.state.started = true;

      process.env = { ...before };

      this.state.log("[DEBUG] Starting Done!");
    } catch (e) {
      if (e instanceof Error) {
        let it: any = e;
        do {
          server.ssrFixStacktrace(it);
          it = it.cause;
        } while (it instanceof Error);

        server.ssrFixStacktrace(e);
        if (e.cause instanceof Error) {
          server.ssrFixStacktrace(e.cause);
        }
        this.state.app?.log?.error("App failed to start:", e);
        this.state.app?.log?.info("Waiting for changes to restart...");
      }
      this.state.log("[DEBUG] Alepha app start error");
      this.state.started = false;
    }
  }

  /**
   * Stop the Alepha application.
   */
  async stop(): Promise<void> {
    if (this.state.app?.stop && this.state.started) {
      this.state.log("[DEBUG] Stopping Alepha app...");
      await this.state.app.stop();
      this.state.started = false;
      this.state.log("[DEBUG] Stopping Done!");
    } else {
      this.state.log("[DEBUG] Alepha app not started - skip stop");
    }
  }

  /**
   * Restart the Alepha application.
   *
   * @returns true if the restart was skipped due to locking
   */
  async restart(server: ViteDevServer, invalidate?: boolean): Promise<boolean> {
    if (this.state.lock) {
      this.state.log("[DEBUG] STILL LOCKING");
      return true;
    }

    this.state.log("[DEBUG] LOCK RESTART");
    this.state.lock = Promise.withResolvers();

    const now = Date.now();
    this.state.log("[DEBUG] RESTART");
    await this.stop();
    this.state.log(`[DEBUG] RESTART (stop) in ${Date.now() - now}ms`);

    if (invalidate) {
      server.moduleGraph.invalidateAll();
    }

    await this.start(server);
    this.state.log(`[DEBUG] RESTART OK in ${Date.now() - now}ms`);

    setTimeout(() => {
      this.state.log("[DEBUG] UNLOCK RESTART");
      this.state.lock?.resolve();
      this.state.lock = undefined;
    }, 500);

    return false;
  }

  /**
   * Send reload event to client.
   */
  sendReload(server: ViteDevServer): void {
    server.ws.send({
      type: "custom",
      event: "alepha:reload",
      data: {},
    });
  }
}

/**
 * Check if a URL path is a Vite internal file.
 */
export function isViteInternalPath(pathname: string): boolean {
  const [path] = pathname.split("?");

  // Vite internal files
  if (
    path.startsWith("/@") ||
    path.startsWith("/src") ||
    path.includes("/node_modules/")
  ) {
    return true;
  }

  return false;
}
