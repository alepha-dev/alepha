import { $inject, $mode } from "alepha";

import { DatabaseProvider } from "../providers/drivers/DatabaseProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Built-in migration mode.
 *
 * When `MIGRATE=true` (or `MODE=MIGRATE`) is set, runs database migrations
 * via `DatabaseProvider.migrate()`, then stops the process.
 *
 * Auto-registered by `AlephaOrm` — any app using the ORM module gets
 * `MIGRATE=true node app.js` for free.
 *
 * @example
 * ```bash
 * MIGRATE=true node app.js    # runs migrations, then exits
 * MODE=MIGRATE node app.js    # same effect
 * ```
 */
export class DbMigrationMode {
  protected db = $inject(DatabaseProvider);

  protected mode = $mode({
    env: "MIGRATE",
    ready: async () => {
      await this.db.migrate();
    },
  });
}
