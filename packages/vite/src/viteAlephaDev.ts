import path from "node:path";
import { pathToFileURL } from "node:url";
import { type Alepha, boot, type State } from "@alepha/core";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { importVite } from "./helpers/importVite.ts";

export interface ViteAlephaDevOptions {
  /**
   * Path to the entry file for the server build.
   * If empty, plugin will be disabled.
   */
  serverEntry?: string;

  /**
   * If true, enables debug logging.
   *
   * @default false
   */
  debug?: boolean;
}

const state: ViteAlephaDevState = {
  root: process.cwd().replace(/\\/g, "/"),
  started: false,
  log: (...msg: string[]) => {},
  entry: "",
  onReload: () => {},
};

/**
 * Plug Alepha into Vite development server.
 */
export async function viteAlephaDev(
  options: ViteAlephaDevOptions = {},
): Promise<Plugin> {
  let entry = options.serverEntry;
  if (!entry) {
    entry = await boot.getServerEntry();
    if (!entry) {
      return {
        name: "alepha-dev",
        apply: "serve",
        config() {},
      };
    }
  }

  const log = (...msg: string[]) => {
    if (options.debug) {
      console.log(...msg);
    }
  };

  state.log = log;
  state.entry = entry;

  return {
    name: "alepha-dev",
    apply: "serve",
    configResolved(resolvedConfig) {
      state.config = resolvedConfig;
    },
    async handleHotUpdate(ctx) {
      log("[DEBUG] HMR", ctx.file);

      if (ctx.file.includes("/.idea/")) {
        return [];
      }

      const isServerOnly = !ctx.modules[0]?._clientModule;
      const isBrowserOnly = !ctx.modules[0]?._ssrModule;
      const isSsrEnabled = ssr(state);

      if (isBrowserOnly) {
        log("[DEBUG] HMR - browser only - no reason to reload server");
        return;
      }

      //const invalidate = !ctx.file.startsWith(state.root);
      const invalidate = !ctx.file.startsWith(state.root);
      if (invalidate) {
        log("[DEBUG] HMR - outside root - invalidate all");
      }

      if (!isSsrEnabled && isServerOnly) {
        await restart(state, ctx.server, invalidate);
        return [];
      }

      if (isSsrEnabled && ctx.modules[0]) {
        const skip = await restart(state, ctx.server, invalidate);
        if (skip) {
          return [];
        }

        if (!state.started) {
          log("[DEBUG] HMR - abort due to app not started");
          return [];
        }

        if (isServerOnly && state.started) {
          ctx.server.ws.send({
            type: "custom",
            event: "alepha:reload",
            data: {},
          });
          return [];
        }
      }
    },
    async configureServer(server) {
      // forward vite request to alepha server
      server.middlewares.use((req, res, next) => {
        if (state.started && state.app && req.url && !isViteFile(req.url)) {
          // patch res.end to detect if alepha handled the request
          // if not, we call next() to let vite handle it (e.g. for static files)
          let ended = false;

          const writeHead = res.writeHead.bind(res);
          res.writeHead = (...args: any[]) => {
            ended = true;
            return writeHead(args[0], args[1], args[2]);
          };

          return state.app.events
            .emit("node:request" as any, { req, res })
            .then(() => {
              if (!ended) {
                next();
              }
            });
        }
        next();
      });

      server.config.logger.info = (msg: string) => {
        state.app?.log?.info(msg.trim());
      };

      server.config.logger.clearScreen = () => {};

      await start(state, server);
    },
    async closeBundle() {
      // it's not a good idea
      // log("[DEBUG] Closing bundle");
      // if (state.app?.stop) {
      // 	await state.app.stop();
      // }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------

interface ViteAlephaDevState {
  root: string;
  started: boolean;
  app?: Alepha;
  config?: ResolvedConfig;
  lock?: PromiseWithResolvers<void>;
  log: (...msg: string[]) => void;
  entry: string;
  onReload?: () => void;
}

// ---------------------------------------------------------------------------------------------------------------------

const ssr = (state: ViteAlephaDevState) => {
  if (!state.app) return false;
  return state.app.state.get("react.server.ssr" as keyof State) ?? false;
};

const start = async (state: ViteAlephaDevState, server: ViteDevServer) => {
  const { loadEnv } = await importVite();

  if (state.started) {
    restart(state, server, true);
    return;
  }

  if (!state.config) {
    state.log("[DEBUG] No config - skip starting");
    return;
  }

  state.onReload?.();

  state.log("[DEBUG] Starting Alepha app...");

  state.started = false;
  state.app = undefined;

  const serverEntryPath = path.resolve(state.config.root, state.entry);
  const fileUrl = pathToFileURL(`${serverEntryPath}`).href;
  const env = loadEnv("development", state.config.root, "");
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
    state.log(`[DEBUG] Alepha app loaded in ${Date.now() - now}ms`);
    await new Promise((r) => setTimeout(r, 10));

    state.app = (globalThis as any).__alepha;
    if (!state.app) {
      state.log("[DEBUG] No app found - skip starting");
      return;
    }

    await state.app.start();
    state.started = true;

    process.env = { ...before };

    state.log("[DEBUG] Starting Done!");
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
      state.app?.log?.error("App failed to start:", e);
      state.app?.log?.info("Waiting for changes to restart...");
    }
    state.log("[DEBUG] Alepha app start error");
    state.started = false;
  }
};

const stop = async (state: ViteAlephaDevState) => {
  if (state.app?.stop && state.started) {
    state.log("[DEBUG] Stopping Alepha app...");
    await state.app.stop();
    state.started = false;
    state.log("[DEBUG] Stopping Done!");
  } else {
    state.log("[DEBUG] Alepha app not started - skip stop");
  }
};

const restart = async (
  state: ViteAlephaDevState,
  server: ViteDevServer,
  invalidate?: boolean,
) => {
  if (state.lock) {
    state.log("[DEBUG] STILL LOCKING");
    return true;
  }

  state.log("[DEBUG] LOCK RESTART");
  state.lock = Promise.withResolvers();

  const now = Date.now();
  state.log("[DEBUG] RESTART");
  await stop(state);
  state.log(`[DEBUG] RESTART (stop) in ${Date.now() - now}ms`);

  if (invalidate) {
    server.moduleGraph.invalidateAll();
  }

  await start(state, server);
  state.log(`[DEBUG] RESTART OK in ${Date.now() - now}ms`);

  setTimeout(() => {
    state.log("[DEBUG] UNLOCK RESTART");
    state.lock?.resolve();
    state.lock = undefined;
  }, 500);
};

const isViteFile = (file: string) => {
  const [pathname] = file.split("?");

  // vite internal files
  if (
    pathname.startsWith("/@") ||
    pathname.startsWith("/src") ||
    pathname.includes("/node_modules/")
  ) {
    return true;
  }

  // our backend files
  return false;
};
