import { $module, type Alepha, t } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import * as drizzle from "drizzle-orm";
import { $entity } from "./primitives/$entity.ts";
import { $repository } from "./primitives/$repository.ts";
import { $sequence } from "./primitives/$sequence.ts";
import { DrizzleKitProvider } from "./providers/DrizzleKitProvider.ts";
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

export { drizzle };
export {
  type Page,
  type PageQuery,
  pageQuerySchema,
  pageSchema,
} from "alepha";
export { sql } from "drizzle-orm";
export * from "drizzle-orm/pg-core";
export * from "./constants/PG_SYMBOLS.ts";
export * from "./errors/DbConflictError.ts";
export * from "./errors/DbEntityNotFoundError.ts";
export * from "./errors/DbError.ts";
export * from "./errors/DbMigrationError.ts";
export * from "./errors/DbVersionMismatchError.ts";
export * from "./helpers/parseQueryString.ts";
export * from "./helpers/pgAttr.ts";
export * from "./interfaces/FilterOperators.ts";
export * from "./interfaces/PgQuery.ts";
export * from "./interfaces/PgQueryWhere.ts";
export * from "./primitives/$entity.ts";
export * from "./primitives/$repository.ts";
export * from "./primitives/$sequence.ts";
export * from "./primitives/$transaction.ts";
export * from "./providers/DrizzleKitProvider.ts";
export * from "./providers/drivers/CloudflareD1Provider.ts";
export * from "./providers/drivers/DatabaseProvider.ts";
export * from "./providers/drivers/NodePostgresProvider.ts";
export * from "./providers/drivers/NodeSqliteProvider.ts";
export * from "./providers/PostgresTypeProvider.ts";
export * from "./providers/RepositoryProvider.ts";
export * from "./schemas/insertSchema.ts";
export * from "./schemas/legacyIdSchema.ts";
export * from "./schemas/updateSchema.ts";
export * from "./services/Repository.ts";
export * from "./types/schema.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Postgres client based on Drizzle ORM, Alepha type-safe friendly.
 *
 * ```ts
 * const users = $entity({
 *   name: "users",
 *   schema: t.object({
 *     id: pg.primaryKey(),
 *     name: t.text(),
 *     email: t.text(),
 *   }),
 * });
 *
 * class Db {
 *   users = $repository(users);
 * }
 *
 * const db = alepha.inject(Db);
 * const user = await db.users.one({ name: { eq: "John Doe" } });
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
 * @module alepha.postgres
 */
export const AlephaPostgres = $module({
  name: "alepha.postgres",
  primitives: [$sequence, $entity],
  services: [
    AlephaDateTime,
    DatabaseProvider,
    NodePostgresProvider,
    PglitePostgresProvider,
    NodeSqliteProvider,
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
        use: NodePostgresProvider,
      });
      return;
    }

    alepha.with({
      optional: true,
      provide: DatabaseProvider,
      use: NodeSqliteProvider,
    });
  },
});
