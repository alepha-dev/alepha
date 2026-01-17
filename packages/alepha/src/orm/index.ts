import { $module, type Alepha, t } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { $entity } from "./primitives/$entity.ts";
import { $sequence } from "./primitives/$sequence.ts";
import { DrizzleKitProvider } from "./providers/DrizzleKitProvider.ts";
import { BunPostgresProvider } from "./providers/drivers/BunPostgresProvider.ts";
import { BunSqliteProvider } from "./providers/drivers/BunSqliteProvider.ts";
import { CloudflareD1Provider } from "./providers/drivers/CloudflareD1Provider.ts";
import { DatabaseProvider } from "./providers/drivers/DatabaseProvider.ts";
import { NodePostgresProvider } from "./providers/drivers/NodePostgresProvider.ts";
import { NodeSqliteProvider } from "./providers/drivers/NodeSqliteProvider.ts";
import { PglitePostgresProvider } from "./providers/drivers/PglitePostgresProvider.ts";
import { RepositoryProvider } from "./providers/RepositoryProvider.ts";
import { PgRelationManager } from "./services/PgRelationManager.ts";
import { PostgresModelBuilder } from "./services/PostgresModelBuilder.ts";
import { QueryManager } from "./services/QueryManager.ts";
import { Repository } from "./services/Repository.ts";
import { SqliteModelBuilder } from "./services/SqliteModelBuilder.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
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
export * from "./providers/drivers/BunPostgresProvider.ts";
export * from "./providers/drivers/BunSqliteProvider.ts";
export * from "./providers/drivers/NodePostgresProvider.ts";
export * from "./providers/drivers/NodeSqliteProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Postgres client based on Drizzle ORM, Alepha type-safe friendly.
 *
 * Automatically selects the appropriate provider based on runtime:
 * - Bun: Uses `BunPostgresProvider` or `BunSqliteProvider`
 * - Node.js: Uses `NodePostgresProvider` or `NodeSqliteProvider`
 *
 * ```ts
 * import { t } from "alepha";
 * import { $entity, $repository, db } from "alepha/postgres";
 *
 * const users = $entity({
 *   name: "users",
 *   schema: t.object({
 *     id: db.primaryKey(),
 *     name: t.text(),
 *     email: t.text(),
 *   }),
 * });
 *
 * class App {
 *   users = $repository(users);
 *
 *   getUserByName(name: string) {
 *     return this.users.findOne({ name: { eq: name } });
 *   }
 * }
 * ```
 *
 * This is not a full ORM, but rather a set of tools to work with Postgres databases in a type-safe way.
 *
 * It provides:
 * - A type-safe way to define entities and repositories. (via `$entity` and `$repository`)
 * - Custom query builders and filters.
 * - Built-in special columns like `createdAt`, `updatedAt`, `deletedAt`, `version`.
 * - Automatic JSONB support.
 * - Automatic synchronization of entities with the database schema (for testing and development).
 * - Fallback to raw SQL via Drizzle ORM `sql` function.
 *
 * Migrations are supported via Drizzle ORM, you need to use the `drizzle-kit` CLI tool to generate and run migrations.
 *
 * @see {@link $entity}
 * @see {@link $sequence}
 * @see {@link $repository}
 * @see {@link $transaction}
 * @see {@link NodePostgresProvider} - Node.js Postgres implementation
 * @see {@link NodeSqliteProvider} - Node.js SQLite implementation
 * @see {@link BunPostgresProvider} - Bun Postgres implementation
 * @see {@link BunSqliteProvider} - Bun SQLite implementation
 * @module alepha.postgres
 */
export const AlephaPostgres = $module({
  name: "alepha.postgres",
  primitives: [$sequence, $entity],
  services: [
    AlephaDateTime,
    DatabaseProvider,
    NodePostgresProvider,
    NodeSqliteProvider,
    BunPostgresProvider,
    BunSqliteProvider,
    PglitePostgresProvider,
    CloudflareD1Provider,
    SqliteModelBuilder,
    PostgresModelBuilder,
    DrizzleKitProvider,
    RepositoryProvider,
    Repository,
    PgRelationManager,
    QueryManager,
  ],
  register: (alepha: Alepha) => {
    const env = alepha.parseEnv(
      t.object({
        DATABASE_URL: t.optional(t.text()),
      }),
    );

    alepha.with(DrizzleKitProvider);
    alepha.with(RepositoryProvider);

    const url = env.DATABASE_URL;
    const hasPGlite = !!PglitePostgresProvider.importPglite();
    const isPostgres = url?.startsWith("postgres:");
    const isSqlite = url?.startsWith("sqlite:");
    const isMemory = url?.includes(":memory:");
    const isFile = !!url && !isPostgres && !isMemory;
    const isBun = alepha.isBun();

    if (url?.startsWith("cloudflare-d1:")) {
      alepha.with({
        optional: true,
        provide: DatabaseProvider,
        use: CloudflareD1Provider,
      });
      return;
    }

    if (hasPGlite && (isMemory || isFile || !url) && !isSqlite) {
      alepha.with({
        optional: true,
        provide: DatabaseProvider,
        use: PglitePostgresProvider,
      });
      return;
    }

    if (isPostgres) {
      alepha.with({
        optional: true,
        provide: DatabaseProvider,
        use: isBun ? BunPostgresProvider : NodePostgresProvider,
      });
      return;
    }

    alepha.with({
      optional: true,
      provide: DatabaseProvider,
      use: isBun ? BunSqliteProvider : NodeSqliteProvider,
    });
  },
});
