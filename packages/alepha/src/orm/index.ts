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

export const SqliteProvider = NodeSqliteProvider;

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | type | quality | stability |
 * |------|---------|-----------|
 * | backend | epic | stable |
 *
 * Full-featured database abstraction built on Drizzle ORM with complete type safety.
 *
 * **Features:**
 * - Define database entities with TypeBox schemas
 * - Automatic timestamps, soft deletes, and versioning columns
 * - Type-safe CRUD operations with filtering, pagination, sorting, and relationships
 * - Database transaction support with automatic rollback
 * - Auto-incrementing sequences for IDs
 * - PostgreSQL support (Node.js, Bun, Cloudflare Workers via pglite)
 * - SQLite support (Node.js, Bun, Cloudflare D1)
 * - Automatic schema sync for development/testing
 * - Drizzle Kit migrations for production
 * - Type-safe filters: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `like`, `between`
 * - JSONB column support
 * - Relationship joins
 *
 * @module alepha.postgres
 */
export const AlephaOrm = $module({
  name: "alepha.orm",
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
