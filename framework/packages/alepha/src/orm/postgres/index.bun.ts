import { $module, type Alepha } from "alepha";
import {
  AlephaOrm,
  DatabaseProvider,
  DatabaseUrlParser,
  databaseEnvSchema,
} from "alepha/orm";

import { BunPostgresProvider } from "./providers/BunPostgresProvider.ts";
import { PostgresProvider } from "./providers/PostgresProvider.ts";
import { PostgresModelBuilder } from "./services/PostgresModelBuilder.ts";

export * from "./providers/BunPostgresProvider.ts";
export * from "./providers/PostgresProvider.ts";
export * from "./schemas/postgresEnvSchema.ts";
export * from "./services/PostgresModelBuilder.ts";
export * from "./types/byte.ts";

export const AlephaOrmPostgres = $module({
  name: "alepha.orm.postgres",
  services: [PostgresModelBuilder],
  variants: [PostgresProvider, BunPostgresProvider],
  register: (alepha: Alepha) => {
    const env = alepha.parseEnv(databaseEnvSchema);

    const kind = new DatabaseUrlParser().kind(env.DATABASE_URL);

    if (kind === "postgres") {
      alepha.with({
        optional: true,
        provide: DatabaseProvider,
        use: BunPostgresProvider,
      });
    }

    // Chain core ORM module AFTER substitution so its own SQLite default
    // doesn't preempt our Postgres-specific provider choice.
    alepha.with(AlephaOrm);
  },
});
