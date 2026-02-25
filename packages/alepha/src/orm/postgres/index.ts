import { $module, type Alepha, t } from "alepha";
import { AlephaOrm, DatabaseProvider } from "alepha/orm";
import { BunPostgresProvider } from "./providers/BunPostgresProvider.ts";
import { CloudflareHyperdriveProvider } from "./providers/CloudflareHyperdriveProvider.ts";
import { NodePostgresProvider } from "./providers/NodePostgresProvider.ts";
import { PglitePostgresProvider } from "./providers/PglitePostgresProvider.ts";
import { PostgresProvider } from "./providers/PostgresProvider.ts";
import { PostgresModelBuilder } from "./services/PostgresModelBuilder.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/BunPostgresProvider.ts";
export * from "./providers/CloudflareHyperdriveProvider.ts";
export * from "./providers/NodePostgresProvider.ts";
export * from "./providers/PglitePostgresProvider.ts";
export * from "./providers/PostgresProvider.ts";
export * from "./services/PostgresModelBuilder.ts";
export * from "./types/byte.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaOrmPostgres = $module({
  name: "alepha.orm.postgres",
  primitives: [],
  services: [
    PostgresProvider,
    CloudflareHyperdriveProvider,
    NodePostgresProvider,
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
    const isBun = alepha.isBun();

    if (url?.startsWith("hyperdrive:")) {
      alepha.with({
        optional: true,
        provide: DatabaseProvider,
        use: CloudflareHyperdriveProvider,
      });
    } else if (url?.startsWith("pglite:")) {
      alepha.with({
        optional: true,
        provide: DatabaseProvider,
        use: PglitePostgresProvider,
      });
    } else if (url?.startsWith("postgres:")) {
      alepha.with({
        optional: true,
        provide: DatabaseProvider,
        use: isBun ? BunPostgresProvider : NodePostgresProvider,
      });
    }

    // Also chain core ORM module
    alepha.with(AlephaOrm);
  },
});
