import { $module, type Alepha } from "alepha";
import { AlephaOrm, DatabaseProvider, databaseEnvSchema } from "alepha/orm";

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
export * from "./schemas/postgresEnvSchema.ts";
export * from "./services/PostgresModelBuilder.ts";
export * from "./types/byte.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * PostgreSQL drivers for the Alepha ORM.
 *
 * Selected automatically from the `DATABASE_URL` prefix: `postgres://`
 * (Node/Bun), `pglite://` (embedded), `hyperdrive://` (Cloudflare Workers).
 *
 * @module alepha.orm.postgres
 */
export const AlephaOrmPostgres = $module({
  name: "alepha.orm.postgres",
  services: [PostgresModelBuilder],
  variants: [
    PostgresProvider,
    CloudflareHyperdriveProvider,
    NodePostgresProvider,
    BunPostgresProvider,
    PglitePostgresProvider,
  ],
  register: (alepha: Alepha) => {
    const env = alepha.parseEnv(databaseEnvSchema);

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

    // Chain core ORM module AFTER substitution so its own SQLite default
    // doesn't preempt our Postgres-specific provider choice.
    alepha.with(AlephaOrm);
  },
});
