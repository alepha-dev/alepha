import { $module, type Alepha, t } from "@alepha/core";
import { AlephaDateTime } from "@alepha/datetime";
import * as drizzle from "drizzle-orm";
import { $entity } from "./descriptors/$entity.ts";
import { $repository } from "./descriptors/$repository.ts";
import { $sequence } from "./descriptors/$sequence.ts";
import { DrizzleKitProvider } from "./providers/DrizzleKitProvider.ts";
import { DrizzleSchemaCodec } from "./providers/DrizzleSchemaCodec.ts";
import { DatabaseProvider } from "./providers/drivers/DatabaseProvider.ts";
import { NodePostgresProvider } from "./providers/drivers/NodePostgresProvider.ts";
import { NodeSqliteProvider } from "./providers/drivers/NodeSqliteProvider.ts";
import { PglitePostgresProvider } from "./providers/drivers/PglitePostgresProvider.ts";
import { RepositoryProvider } from "./providers/RepositoryProvider.ts";
import { PostgresModelBuilder } from "./services/PostgresModelBuilder.ts";
import { SqliteModelBuilder } from "./services/SqliteModelBuilder.ts";

// ---------------------------------------------------------------------------------------------------------------------

export { drizzle };
export {
  type Page,
  type PageQuery,
  pageQuerySchema,
  pageSchema,
} from "@alepha/core";
export { sql } from "drizzle-orm";
export * from "drizzle-orm/pg-core";
export * from "./constants/PG_SYMBOLS.ts";
export * from "./descriptors/$entity.ts";
export * from "./descriptors/$repository.ts";
export * from "./descriptors/$sequence.ts";
export * from "./descriptors/$transaction.ts";
export * from "./errors/PgConflictError.ts";
export * from "./errors/PgEntityNotFoundError.ts";
export * from "./errors/PgError.ts";
export * from "./errors/PgMigrationError.ts";
export * from "./errors/PgVersionMismatchError.ts";
export * from "./helpers/pgAttr.ts";
export * from "./interfaces/FilterOperators.ts";
export * from "./interfaces/PgQuery.ts";
export * from "./interfaces/PgQueryWhere.ts";
export * from "./providers/DrizzleKitProvider.ts";
export * from "./providers/drivers/DatabaseProvider.ts";
export * from "./providers/drivers/NodePostgresProvider.ts";
export * from "./providers/PostgresTypeProvider.ts";
export * from "./providers/RepositoryProvider.ts";
export * from "./schemas/insertSchema.ts";
export * from "./schemas/legacyIdSchema.ts";
export * from "./schemas/updateSchema.ts";
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
  descriptors: [$repository, $sequence, $entity],
  services: [
    AlephaDateTime,
    DatabaseProvider,
    NodePostgresProvider,
    PglitePostgresProvider,
    NodeSqliteProvider,
    SqliteModelBuilder,
    PostgresModelBuilder,
    DrizzleKitProvider,
    DrizzleSchemaCodec,
    RepositoryProvider,
  ],
  register: (alepha: Alepha) => {
    const env = alepha.parseEnv(
      t.object({
        DATABASE_URL: t.optional(t.text()),
      }),
    );

    alepha.with(DrizzleKitProvider);
    alepha.with(RepositoryProvider);

    alepha.codec.register("drizzle", alepha.inject(DrizzleSchemaCodec));

    const url = env.DATABASE_URL;
    const hasPGlite = !!PglitePostgresProvider.importPglite();
    const isPostgres = url?.startsWith("postgres:");
    const isSqlite = url?.startsWith("sqlite:");
    const isMemory = url?.includes(":memory:");
    const isFile = !!url && !isPostgres && !isMemory;

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
