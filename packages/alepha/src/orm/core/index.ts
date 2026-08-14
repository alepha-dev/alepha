import { $module, type Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import type { PgAsyncTransaction } from "drizzle-orm/pg-core";
import { DbMigrationMode } from "./modes/DbMigrationMode.ts";
import { $entity } from "./primitives/$entity.ts";
import { $sequence } from "./primitives/$sequence.ts";
import { DrizzleKitProvider } from "./providers/DrizzleKitProvider.ts";
import { BunSqliteProvider } from "./providers/drivers/BunSqliteProvider.ts";
import { CloudflareD1Provider } from "./providers/drivers/CloudflareD1Provider.ts";
import { DatabaseProvider } from "./providers/drivers/DatabaseProvider.ts";
import { NodeSqliteProvider } from "./providers/drivers/NodeSqliteProvider.ts";
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
