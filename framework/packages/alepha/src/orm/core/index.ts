import { $module, type Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";

import type {
  D1DatabaseSession,
  D1SessionState,
} from "./interfaces/D1Database.ts";
import type { DbTransaction } from "./interfaces/DbTransaction.ts";
import type { TransactionOptions } from "./interfaces/TransactionOptions.ts";
import { DbMigrationMode } from "./modes/DbMigrationMode.ts";
import { $entity } from "./primitives/$entity.ts";
import { $sequence } from "./primitives/$sequence.ts";
import { BunSqliteProvider } from "./providers/drivers/BunSqliteProvider.ts";
import { CloudflareD1Provider } from "./providers/drivers/CloudflareD1Provider.ts";
import { CloudflareHyperdriveProvider } from "./providers/drivers/CloudflareHyperdriveProvider.ts";
import { DatabaseProvider } from "./providers/drivers/DatabaseProvider.ts";
import { NodePostgresProvider } from "./providers/drivers/NodePostgresProvider.ts";
import { NodeSqliteProvider } from "./providers/drivers/NodeSqliteProvider.ts";
import { PostgresProvider } from "./providers/drivers/PostgresProvider.ts";
import { DrizzleKitProvider } from "./providers/DrizzleKitProvider.ts";
import { RepositoryProvider } from "./providers/RepositoryProvider.ts";
import { SequenceProvider } from "./providers/SequenceProvider.ts";
import { databaseEnvSchema } from "./schemas/databaseEnvSchema.ts";
import { DatabaseUrlParser } from "./services/DatabaseUrlParser.ts";
import { PgRelationManager } from "./services/PgRelationManager.ts";
import { PostgresModelBuilder } from "./services/PostgresModelBuilder.ts";
import { QueryManager } from "./services/QueryManager.ts";
import { Repository } from "./services/Repository.ts";
import { SqliteModelBuilder } from "./services/SqliteModelBuilder.ts";
import { SqliteTypeAuditService } from "./services/SqliteTypeAuditService.ts";
import { TestPostgresRegistration } from "./testing/AlephaOrmTestPostgres.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface State {
    /**
     * The transaction of the current `$transactional` block.
     */
    "alepha.orm.tx"?: DbTransaction;
    /**
     * The options the current transaction was opened with, which a nested
     * `$transactional` is checked against before it joins.
     */
    "alepha.orm.txOptions"?: TransactionOptions;
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
 * - SQLite by default, Postgres when `DATABASE_URL` says so: `postgres://`
 *   or `postgresql://` on Node and Bun, `hyperdrive://` on Cloudflare
 *   Workers, `d1://` for Cloudflare D1. The Postgres drivers are loaded on
 *   connect, so a SQLite app never evaluates them.
 *
 * @module alepha.orm
 */
export const AlephaOrm = $module({
  name: "alepha.orm",
  primitives: [$sequence, $entity],
  imports: [AlephaDateTime],
  services: [
    DatabaseUrlParser,
    SqliteModelBuilder,
    SqliteTypeAuditService,
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
    PostgresProvider,
    NodePostgresProvider,
    CloudflareHyperdriveProvider,
    // A variant rather than a service: only a Postgres provider (or the
    // offline migration generator) asks for it, so a SQLite app never
    // builds one.
    PostgresModelBuilder,
  ],
  register: (alepha: Alepha) => {
    const env = alepha.parseEnv(databaseEnvSchema);

    const kind = new DatabaseUrlParser().kind(env.DATABASE_URL);
    const isBun = alepha.isBun();

    alepha.with({
      optional: true,
      provide: DatabaseProvider,
      use:
        kind === "d1"
          ? CloudflareD1Provider
          : kind === "hyperdrive"
            ? CloudflareHyperdriveProvider
            : kind === "postgres"
              ? // Bun resolves the `bun` barrel, whose register picks
                // BunPostgresProvider: this one never reaches `drizzle-orm/bun-sql`,
                // which a workerd build cannot resolve.
                NodePostgresProvider
              : // No URL, or a SQLite one: SQLite is the default.
                isBun
                ? BunSqliteProvider
                : NodeSqliteProvider,
    });
  },
});

/**
 * Runs one spec on Postgres instead of the SQLite default.
 *
 * A spec gets an in-memory SQLite database when it names no `DATABASE_URL`.
 * Registering this module points it at the Postgres server
 * `POSTGRES_TEST_URL` names instead (a spec that names its own `DATABASE_URL`
 * keeps it), through the same provider `DATABASE_URL=postgres://...` would
 * select. Each run still gets a schema of its own, so specs on one server do
 * not see each other's rows. It registers `AlephaOrm` where it stands.
 *
 * Refused outside `NODE_ENV=test`, and when `POSTGRES_TEST_URL` is needed and
 * not set.
 *
 * @example
 * ```ts
 * // POSTGRES_TEST_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres
 * const alepha = Alepha.create().with(AlephaOrmTestPostgres);
 * ```
 *
 * @module alepha.orm.test-postgres
 */
export const AlephaOrmTestPostgres = $module({
  name: "alepha.orm.test-postgres",
  register: (alepha: Alepha) =>
    new TestPostgresRegistration().register(alepha, AlephaOrm),
});
