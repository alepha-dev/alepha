import { $module, type Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";

import { DbMigrationMode } from "./modes/DbMigrationMode.ts";
import { $entity } from "./primitives/$entity.ts";
import { $sequence } from "./primitives/$sequence.ts";
import { BunPostgresProvider } from "./providers/drivers/BunPostgresProvider.ts";
import { BunSqliteProvider } from "./providers/drivers/BunSqliteProvider.ts";
import { CloudflareD1Provider } from "./providers/drivers/CloudflareD1Provider.ts";
import { DatabaseProvider } from "./providers/drivers/DatabaseProvider.ts";
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
import { TestPostgresRegistration } from "./testing/AlephaOrmTestPostgres.ts";

export const SqliteProvider = BunSqliteProvider;

export * from "./index.shared-server.ts";
export * from "./providers/drivers/BunPostgresProvider.ts";
export * from "./providers/drivers/BunSqliteProvider.ts";

export const AlephaOrm = $module({
  name: "alepha.orm",
  primitives: [$sequence, $entity],
  imports: [AlephaDateTime],
  services: [
    DatabaseUrlParser,
    SqliteModelBuilder,
    DrizzleKitProvider,
    RepositoryProvider,
    SequenceProvider,
    PgRelationManager,
    QueryManager,
    DbMigrationMode,
  ],
  // Variants are tagged with module metadata but never auto-injected.
  // - DatabaseProvider is abstract; a driver is substituted in via register().
  // - Repository is a base class instantiated per-entity via $repository(entity).
  variants: [
    DatabaseProvider,
    Repository,
    BunSqliteProvider,
    CloudflareD1Provider,
    PostgresProvider,
    BunPostgresProvider,
    PostgresModelBuilder,
  ],
  register: (alepha: Alepha) => {
    const env = alepha.parseEnv(databaseEnvSchema);

    const kind = new DatabaseUrlParser().kind(env.DATABASE_URL);

    alepha.with({
      optional: true,
      provide: DatabaseProvider,
      use:
        kind === "d1"
          ? CloudflareD1Provider
          : kind === "postgres"
            ? BunPostgresProvider
            : // No URL, or a SQLite one: SQLite is the default under Bun.
              BunSqliteProvider,
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
