import { $module, type Alepha, t } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { $entity } from "./primitives/$entity.ts";
import { $sequence } from "./primitives/$sequence.ts";
import { DrizzleKitProvider } from "./providers/DrizzleKitProvider.ts";
import { BunPostgresProvider } from "./providers/drivers/BunPostgresProvider.ts";
import { BunSqliteProvider } from "./providers/drivers/BunSqliteProvider.ts";
import { CloudflareD1Provider } from "./providers/drivers/CloudflareD1Provider.ts";
import { DatabaseProvider } from "./providers/drivers/DatabaseProvider.ts";
import { PglitePostgresProvider } from "./providers/drivers/PglitePostgresProvider.ts";
import { RepositoryProvider } from "./providers/RepositoryProvider.ts";
import { PgRelationManager } from "./services/PgRelationManager.ts";
import { PostgresModelBuilder } from "./services/PostgresModelBuilder.ts";
import { QueryManager } from "./services/QueryManager.ts";
import { Repository } from "./services/Repository.ts";
import { SqliteModelBuilder } from "./services/SqliteModelBuilder.ts";

export const SqliteProvider = BunSqliteProvider;

export * from "./index.shared-server.ts";
export * from "./providers/drivers/BunPostgresProvider.ts";
export * from "./providers/drivers/BunSqliteProvider.ts";

export const AlephaOrm = $module({
  name: "alepha.orm",
  primitives: [$sequence, $entity],
  services: [
    AlephaDateTime,
    DatabaseProvider,
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
    const isPostgres = url?.startsWith("postgres:");

    if (url?.startsWith("cloudflare-d1:")) {
      alepha.with({
        optional: true,
        provide: DatabaseProvider,
        use: CloudflareD1Provider,
      });
      return;
    }

    if (isPostgres) {
      alepha.with({
        optional: true,
        provide: DatabaseProvider,
        use: BunPostgresProvider,
      });
      return;
    }

    alepha.with({
      optional: true,
      provide: DatabaseProvider,
      use: BunSqliteProvider,
    });
  },
});
