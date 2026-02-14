import { $context, $mode, type Alepha } from "alepha";
import { DatabaseProvider } from "../providers/drivers/DatabaseProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export interface SeedOptions {
  /**
   * Seed handler, executed inside a database transaction.
   *
   * If the handler throws, the transaction is rolled back automatically.
   */
  handler: (ctx: { alepha: Alepha; db: DatabaseProvider }) => any;
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Activate seed mode: a convenience wrapper around `$mode` that runs the handler
 * inside a database transaction.
 *
 * When `SEED=true` (or `MODE=SEED`) is set, the owning class becomes `alepha.target`,
 * the graph is pruned, and the handler runs inside `db.transactional()`.
 * After completion (or error), the app stops automatically.
 *
 * Returns `true` if seed mode is active, `false` otherwise.
 *
 * @example
 * ```ts
 * import { $seed } from "alepha/orm";
 * import { $repository } from "alepha/orm";
 *
 * class AppSeed {
 *   users = $repository(userEntity);
 *
 *   seed = $seed({
 *     handler: async () => {
 *       await this.users.create({ name: "John Doe" });
 *     },
 *   });
 * }
 * ```
 *
 * ```bash
 * SEED=true node app.js
 * ```
 */
export const $seed = (args: SeedOptions): boolean => {
  const { alepha } = $context();
  const db = alepha.inject(DatabaseProvider);

  return $mode({
    env: "SEED",
    ready: async () => {
      await db.transactional(async () => {
        await args.handler({ alepha, db });
      });
    },
  });
};
