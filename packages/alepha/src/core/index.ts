/// <reference types="vite/client" />
import { AsyncLocalStorage } from "node:async_hooks";
import cluster from "node:cluster";
import { cpus } from "node:os";
import { Alepha } from "./Alepha.ts";
import type { RunOptions } from "./interfaces/Run.ts";
import type { Service } from "./interfaces/Service.ts";
import { $module } from "./primitives/$module.ts";
import { AlsProvider } from "./providers/AlsProvider.ts";
import { CodecManager } from "./providers/CodecManager.ts";
import { EventManager } from "./providers/EventManager.ts";
import { Json } from "./providers/Json.ts";
import { JsonSchemaCodec } from "./providers/JsonSchemaCodec.ts";
import { KeylessJsonSchemaCodec } from "./providers/KeylessJsonSchemaCodec.ts";
import { SchemaCodec } from "./providers/SchemaCodec.ts";
import { SchemaValidator } from "./providers/SchemaValidator.ts";
import { StateManager } from "./providers/StateManager.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Foundation of the entire framework with dependency injection and lifecycle management.
 *
 * **Features:**
 * - Dependency injection for services
 * - Service substitution/mocking
 * - Type-safe environment variable loading with TypeBox schemas
 * - Lifecycle hooks (start, stop, log, etc.)
 * - Module definitions and composition
 * - Request-scoped context access via Async Local Storage (ALS)
 * - Reactive state management with atoms
 * - Cluster mode with automatic worker forking
 * - Full TypeScript generics and type inference
 *
 * @module alepha.core
 */
export const AlephaCore = $module({
  name: "alepha.core",
  services: [
    StateManager,
    CodecManager,
    EventManager,
    AlsProvider,
    Json,
    JsonSchemaCodec,
    KeylessJsonSchemaCodec,
    SchemaCodec,
    SchemaValidator,
  ],
  register: () => {
    // skip registration, Alepha will handle it
  },
});

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

  if (opts?.cluster) {
    withCluster(entry, opts);
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
              process.exit(0);
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

/**
 * Run Alepha in cluster mode, forking workers based on the number of CPU cores.
 */
const withCluster = (
  entry: Alepha | Service | Array<Service>,
  opts?: RunOptions,
) => {
  const numCPUs = cpus().length;
  if (cluster.isPrimary) {
    for (let i = 0; i < numCPUs; i++) {
      cluster.fork();
    }
  } else {
    run(entry, {
      ...opts,
      env: {
        ...opts?.env,
        APP_NAME: `${opts?.env?.APP_NAME || "P"}-${cluster.worker?.id}`,
      },
      cluster: false,
    });
  }
};
