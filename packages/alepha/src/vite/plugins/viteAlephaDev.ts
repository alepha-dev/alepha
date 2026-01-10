import type { IncomingMessage, ServerResponse } from "node:http";
import {
  loadEnv,
  type Plugin,
  type ResolvedConfig,
  type UserConfig,
} from "vite";
import { boot } from "../helpers/boot.ts";
import { createAlephaRunner, isViteInternalPath } from "../tasks/runAlepha.ts";

export interface ViteAlephaDevOptions {
  /**
   * Path to the entry file for the server build.
   * If empty, plugin will be disabled.
   */
  serverEntry?: string | false;

  /**
   * If true, enables debug logging.
   *
   * @default false
   */
  debug?: boolean;
}

/**
 * Plug Alepha into Vite development server.
 *
 * This plugin manages the Alepha application lifecycle during development,
 * handling hot module replacement and request forwarding.
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

  const runner = createAlephaRunner({
    entry,
    debug: options.debug,
  });

  const env = loadEnv("development", process.cwd(), "SERVER");

  const config: UserConfig = {};
  if (env.SERVER_PORT) {
    config.server = {
      port: parseInt(env.SERVER_PORT, 10),
    };
  }

  return {
    name: "alepha-dev",
    apply: "serve",
    config: () => config,
    configResolved(resolvedConfig: ResolvedConfig) {
      runner.setConfig(resolvedConfig);
    },
    async handleHotUpdate(ctx) {
      if (options.debug) {
        console.log("[DEBUG] HMR", ctx.file);
      }

      if (ctx.file.includes("/.idea/")) {
        return [];
      }

      const isServerOnly = !ctx.modules[0]?._clientModule;
      const isBrowserOnly = !ctx.modules[0]?._ssrModule;
      const isSsrEnabled = runner.isSsrEnabled();

      if (isBrowserOnly) {
        if (options.debug) {
          console.log(
            "[DEBUG] HMR - browser only - no reason to reload server",
          );
        }
        return;
      }

      const root = process.cwd().replace(/\\/g, "/");
      const invalidate = !ctx.file.startsWith(root);
      if (invalidate && options.debug) {
        console.log("[DEBUG] HMR - outside root - invalidate all");
      }

      if (!isSsrEnabled && isServerOnly) {
        await runner.restart(ctx.server, invalidate);
        return [];
      }

      if (isSsrEnabled && ctx.modules[0]) {
        const skip = await runner.restart(ctx.server, invalidate);
        if (skip) {
          return [];
        }

        if (!runner.isStarted) {
          if (options.debug) {
            console.log("[DEBUG] HMR - abort due to app not started");
          }
          return [];
        }

        if (isServerOnly && runner.isStarted) {
          runner.sendReload(ctx.server);
          return [];
        }
      }
    },
    async configureServer(server) {
      if (env.SERVER_PORT) {
        server.config.server.port = parseInt(env.SERVER_PORT, 10);
      }
      const middleware = (
        req: IncomingMessage,
        res: ServerResponse,
        next: any,
      ) => {
        if (
          runner.isStarted &&
          runner.app &&
          req.url &&
          !isViteInternalPath(req.url)
        ) {
          // Patch res.end to detect if alepha handled the request
          // If not, we call next() to let vite handle it (e.g. for static files)
          let ended = false;

          const writeHead = res.writeHead.bind(res);
          res.writeHead = (...args: any[]) => {
            ended = true;
            return writeHead(args[0], args[1], args[2]);
          };

          return runner.app.events
            .emit("node:request" as any, { req, res })
            .then(() => {
              if (!ended) {
                next();
              }
            });
        }
        next();
      };

      // Forward vite request to alepha server
      server.middlewares.use((req, res, next) => {
        // TODO: wait if restarting ?
        middleware(req, res, next);
      });

      server.config.logger.info = (msg: string) => {
        console.log(msg);
      };

      server.config.logger.clearScreen = () => {};

      // Return a function - it runs AFTER internal middlewares are set up
      // and after buildStart has been called
      return () => {
        server.httpServer?.once("listening", () => {
          runner.start(server);
        });
      };
    },
    async closeBundle() {
      // Cleanup handled by runner
    },
  };
}
