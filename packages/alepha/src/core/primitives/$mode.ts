import type { Alepha } from "../Alepha.ts";
import { $context } from "./$context.ts";

// ---------------------------------------------------------------------------------------------------------------------

export interface ModeOptions {
  /**
   * Environment variable to check for.
   *
   * The mode activates when:
   * - The env variable is truthy (e.g. `MIGRATE=true`), OR
   * - The `MODE` env equals this value (e.g. `MODE=MIGRATE`)
   *
   * @example "MIGRATE"
   * @example "SEED"
   * @example "CONSOLE"
   */
  env: string;

  /**
   * Callback to execute when the mode is activated and the app is ready.
   *
   * After the callback completes (or throws), `alepha.stop()` is called automatically
   * to ensure graceful shutdown (close DB connections, etc.).
   *
   * If omitted, the mode activates (graph is pruned) but the process stays alive.
   * Useful for long-running modes like queue workers or cron.
   */
  ready?: (alepha: Alepha) => void | Promise<void>;
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Activate a selective bootstrap mode.
 *
 * When the environment condition matches, the owning class becomes `alepha.target`:
 * the DI graph is pruned to only this class and its transitive dependencies.
 * Everything else (HTTP server, job scheduler, etc.) is discarded.
 *
 * Returns `true` if the mode is active, `false` otherwise.
 *
 * @example
 * ```ts
 * import { $mode, $inject } from "alepha";
 * import { DatabaseProvider } from "alepha/orm";
 *
 * class DbMigrationMode {
 *   db = $inject(DatabaseProvider);
 *
 *   mode = $mode({
 *     env: "MIGRATE",
 *     ready: async () => {
 *       await this.db.migrate();
 *     },
 *   });
 * }
 * ```
 *
 * ```bash
 * MIGRATE=true node app.js    # runs migrations, then exits
 * MODE=MIGRATE node app.js    # same effect
 * ```
 */
export const $mode = (args: ModeOptions): boolean => {
  const { alepha, service } = $context();

  // Accept MIGRATE=true or MODE=MIGRATE
  if (alepha.env[args.env] || alepha.env.MODE === args.env) {
    alepha.set("alepha.target", service);

    if (args.ready) {
      alepha.events.on("ready", async () => {
        try {
          await args.ready!(alepha);
        } finally {
          await alepha.stop();
        }
      });
    }

    return true;
  }

  return false;
};
