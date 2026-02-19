import { $module, type Alepha, t } from "alepha";
import { AlephaOrm, DatabaseProvider } from "alepha/orm";
import { BunPostgresProvider } from "./providers/BunPostgresProvider.ts";
import { PglitePostgresProvider } from "./providers/PglitePostgresProvider.ts";
import { PostgresProvider } from "./providers/PostgresProvider.ts";
import { PostgresModelBuilder } from "./services/PostgresModelBuilder.ts";

export * from "./providers/BunPostgresProvider.ts";
export * from "./providers/PglitePostgresProvider.ts";
export * from "./providers/PostgresProvider.ts";
export * from "./services/PostgresModelBuilder.ts";
export * from "./types/byte.ts";

export const AlephaOrmPostgres = $module({
  name: "alepha.orm.postgres",
  primitives: [],
  services: [
    PostgresProvider,
    BunPostgresProvider,
    PglitePostgresProvider,
    PostgresModelBuilder,
  ],
  register: (alepha: Alepha) => {
    const env = alepha.parseEnv(
      t.object({
        DATABASE_URL: t.optional(t.text()),
      }),
    );

    const url = env.DATABASE_URL;

    if (url?.startsWith("pglite:")) {
      alepha.with({
        optional: true,
        provide: DatabaseProvider,
        use: PglitePostgresProvider,
      });
      return;
    }

    if (url?.startsWith("postgres:")) {
      alepha.with({
        optional: true,
        provide: DatabaseProvider,
        use: BunPostgresProvider,
      });
      return;
    }

    alepha.with(AlephaOrm);
  },
});
