import { $module, type Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { DbMigrationMode } from "./modes/DbMigrationMode.ts";
import { $entity } from "./primitives/$entity.ts";
import { $sequence } from "./primitives/$sequence.ts";
import { DrizzleKitProvider } from "./providers/DrizzleKitProvider.ts";
import { BunSqliteProvider } from "./providers/drivers/BunSqliteProvider.ts";
import { CloudflareD1Provider } from "./providers/drivers/CloudflareD1Provider.ts";
import { DatabaseProvider } from "./providers/drivers/DatabaseProvider.ts";
import { RepositoryProvider } from "./providers/RepositoryProvider.ts";
import { SequenceProvider } from "./providers/SequenceProvider.ts";
import { databaseEnvSchema } from "./schemas/databaseEnvSchema.ts";
import { PgRelationManager } from "./services/PgRelationManager.ts";
import { QueryManager } from "./services/QueryManager.ts";
import { Repository } from "./services/Repository.ts";
import { SqliteModelBuilder } from "./services/SqliteModelBuilder.ts";

export const SqliteProvider = BunSqliteProvider;

export * from "./index.shared-server.ts";
export * from "./providers/drivers/BunSqliteProvider.ts";

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
  // Variants are tagged with module metadata but never auto-injected.
  // - DatabaseProvider is abstract; a driver is substituted in via register().
  // - Repository is a base class instantiated per-entity via $repository(entity).
  variants: [
    DatabaseProvider,
    Repository,
    BunSqliteProvider,
    CloudflareD1Provider,
  ],
  register: (alepha: Alepha) => {
    const env = alepha.parseEnv(databaseEnvSchema);

    const url = env.DATABASE_URL;

    if (url?.startsWith("d1:")) {
      alepha.with({
        optional: true,
        provide: DatabaseProvider,
        use: CloudflareD1Provider,
      });
    } else {
      // SQLite is the default for core under Bun
      alepha.with({
        optional: true,
        provide: DatabaseProvider,
        use: BunSqliteProvider,
      });
    }
  },
});
