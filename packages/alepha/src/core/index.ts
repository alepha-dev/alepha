/// <reference types="vite/client" />
import { AsyncLocalStorage } from "node:async_hooks";
import { Alepha } from "./Alepha.ts";
import type { RunOptions } from "./interfaces/Run.ts";
import type { Service } from "./interfaces/Service.ts";
import { AlsProvider } from "./providers/AlsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";

// ---------------------------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Run Alepha application, trigger start lifecycle.
 *
 * ```ts
 * import { Alepha, run } from "alepha";
 * import { MyService } from "./services/MyService.ts";
 *
 * const alepha = new Alepha({ env: { APP_NAME: "MyAlephaApp" } });
 *
 * alepha.with(MyService);
 *
 * export default run(alepha);
 * ```
 */
export const run = (
  entry: Alepha | Service | Array<Service>,
  opts?: RunOptions,
): Alepha => {
  const env: Record<string, string | undefined> =
    typeof process === "object" ? process.env : {};

  const alepha =
    entry instanceof Alepha
      ? entry
      : Alepha.create({ env: { ...env, ...opts?.env } });

  if (!(entry instanceof Alepha)) {
    const entries = Array.isArray(entry) ? entry : [entry];
    for (const e of entries) {
      alepha.with(e);
    }
  }

  // make alepha globally accessible (for serverless functions, etc...)
  // it's not recommended, we should force 'export default run(alepha)'
  (globalThis as any).__alepha = alepha;

  // when alepha instance is imported via CLI, use a different global variable
  if (env.ALEPHA_CLI_IMPORT) {
    (globalThis as any).__cli_alepha = alepha;
  }

  if (alepha.isServerless() || alepha.isViteDev() || env.ALEPHA_CLI_IMPORT) {
    return alepha;
  }

  setTimeout(async () => {
    try {
      await opts?.configure?.(alepha);

      await alepha.start();

      if (opts?.ready) {
        await opts.ready(alepha);
      }

      if (opts?.once) {
        await alepha.stop();
        return alepha;
      }

      if (typeof process === "object") {
        const traps = ["SIGTERM", "SIGINT", "SIGUSR2", "uncaughtException"];

        for (const trap of traps) {
          process.once(trap, async (err) => {
            if (trap === "uncaughtException") {
              alepha.log?.error("Uncaught Exception", err);
            } else {
              alepha.log?.info("Received signal", { trap });
            }
            try {
              await alepha.stop();
              console.log(" ");
              // A crash must not report success to orchestrators/CI.
              process.exit(trap === "uncaughtException" ? 1 : 0);
            } catch (error) {
              alepha.log?.error("Alepha failed to stop", error);
              process.exit(1);
            }
          });
        }
      }
    } catch (error) {
      alepha.log?.error("Alepha failed to start", error);
      if (typeof process === "object") {
        process.exit(1);
      }
    }
  });

  return alepha;
};

// ---------------------------------------------------------------------------------------------------------------------

// only for node.js environment
AlsProvider.create = () => new AsyncLocalStorage();
