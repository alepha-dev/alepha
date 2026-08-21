import { $module, type Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import type { PgAsyncTransaction } from "drizzle-orm/pg-core";

import type {
  D1DatabaseSession,
  D1SessionState,
} from "./interfaces/D1Database.ts";
import { DbMigrationMode } from "./modes/DbMigrationMode.ts";
import { $entity } from "./primitives/$entity.ts";
import { $sequence } from "./primitives/$sequence.ts";
import { BunSqliteProvider } from "./providers/drivers/BunSqliteProvider.ts";
import { CloudflareD1Provider } from "./providers/drivers/CloudflareD1Provider.ts";
import { DatabaseProvider } from "./providers/drivers/DatabaseProvider.ts";
import { NodeSqliteProvider } from "./providers/drivers/NodeSqliteProvider.ts";
import { DrizzleKitProvider } from "./providers/DrizzleKitProvider.ts";
import { RepositoryProvider } from "./providers/RepositoryProvider.ts";
import { SequenceProvider } from "./providers/SequenceProvider.ts";
import { databaseEnvSchema } from "./schemas/databaseEnvSchema.ts";
import { PgRelationManager } from "./services/PgRelationManager.ts";
import { QueryManager } from "./services/QueryManager.ts";
import { Repository } from "./services/Repository.ts";
import { SqliteModelBuilder } from "./services/SqliteModelBuilder.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface State {
    "alepha.orm.tx"?: PgAsyncTransaction<any>;
    /**
     * Callbacks queued by `DatabaseProvider.afterCommit()`, created by the
     * outermost `transactional()` block and drained once its COMMIT returns.
     */
    "alepha.orm.afterCommit"?: Array<() => void | Promise<void>>;
    /**
     * The D1 session serving the current async context, when the driver runs
     * in `sessions` mode.
     *
     * Per-context rather than per-provider because a session is the unit of
     * sequential consistency for one logical request: sharing one across
     * concurrent invocations would hand request B the bookmark request A
     * established, which is the stale-read bug replication is supposed to
     * avoid.
     */
    "alepha.orm.d1.session"?: D1SessionState;
    /**
     * A bookmark supplied by whoever owns the request, read when the session
     * opens.
     *
     * This slot is the seam that lets the HTTP layer carry a bookmark across
     * requests without the ORM importing the server module, which it does
     * not do anywhere else and should not start doing for this.
     */
    "alepha.orm.d1.bookmark"?: string;
    /**
     * A holder the request owner creates so it can read the session back.
     *
     * `store.set` only ever writes to the innermost async layer, and a handler
     * runs several layers below whoever owns the request, so the session slot
     * above cannot be read from outside. Mutating this object crosses that
     * boundary, the same way `alepha.orm.afterCommit` does.
     */
    "alepha.orm.d1.carrier"?: { session?: D1DatabaseSession };
  }
  interface Hooks {
    /**
     * Fires before creating an entity in the repository.
     */
    "repository:create:before": {
      tableName: string;
      data: any;
    };
    /**
     * Fires after creating an entity in the repository.
     */
    "repository:create:after": {
      tableName: string;
      data: any;
      entity: any;
    };
    /**
     * Fires before updating entities in the repository.
     */
    "repository:update:before": {
      tableName: string;
      where: any;
      data: any;
    };
    /**
     * Fires after updating entities in the repository.
     */
    "repository:update:after": {
      tableName: string;
      where: any;
      data: any;
      entities: any[];
    };
    /**
     * Fires before deleting entities from the repository.
     */
    "repository:delete:before": {
      tableName: string;
      where: any;
    };
    /**
     * Fires after deleting entities from the repository.
     */
    "repository:delete:after": {
      tableName: string;
      where: any;
      ids: Array<string | number>;
    };
    /**
     * Fires before reading entities from the repository.
     */
    "repository:read:before": {
      tableName: string;
      query: any;
    };
    /**
     * Fires after reading entities from the repository.
     */
    "repository:read:after": {
      tableName: string;
      query: any;
      entities: any[];
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared-server.ts";
export * from "./modes/DbMigrationMode.ts";
export * from "./providers/drivers/BunSqliteProvider.ts";
export * from "./providers/drivers/NodeSqliteProvider.ts";

export const SqliteProvider = NodeSqliteProvider;

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Type-safe data layer over Drizzle ORM.
 *
 * **Features:**
 * - `$entity` schema definitions with Zod + `db` column helpers
 * - `Repository` CRUD, pagination, joins, and optimistic locking
 * - Introspection-based dev schema sync, file-based production migrations
 * - SQLite by default; Postgres via `alepha/orm/postgres`
 *
 * @module alepha.orm
 */
export const AlephaOrm = $module({
  name: "alepha.orm",
  primitives: [$sequence, $entity],
  imports: [AlephaDateTime],
  services: [
    SqliteModelBuilder,
    DrizzleKitProvider,
    RepositoryProvider,
    SequenceProvider,
    PgRelationManager,
    QueryManager,
    DbMigrationMode,
  ],
  // - DatabaseProvider is abstract; one of the driver variants is substituted in via register().
  // - Repository is a base class instantiated per-entity via Repository.of(entity).
  // Both listed for module tagging only — never auto-injected.
  variants: [
    DatabaseProvider,
    Repository,
    NodeSqliteProvider,
    BunSqliteProvider,
    CloudflareD1Provider,
  ],
  register: (alepha: Alepha) => {
    const env = alepha.parseEnv(databaseEnvSchema);

    const url = env.DATABASE_URL;
    const isBun = alepha.isBun();

    if (url?.startsWith("d1:")) {
      alepha.with({
        optional: true,
        provide: DatabaseProvider,
        use: CloudflareD1Provider,
      });
    } else {
      // SQLite is the default for core
      alepha.with({
        optional: true,
        provide: DatabaseProvider,
        use: isBun ? BunSqliteProvider : NodeSqliteProvider,
      });
    }
  },
});
