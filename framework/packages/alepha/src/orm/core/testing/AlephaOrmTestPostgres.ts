import { type Alepha, AlephaError, type Service } from "alepha";

import { DatabaseProvider } from "../providers/drivers/DatabaseProvider.ts";
import { NodePostgresProvider } from "../providers/drivers/NodePostgresProvider.ts";

/**
 * What `AlephaOrmTestPostgres` does, shared by the Node and Bun barrels, each
 * of which declares the module with its own `AlephaOrm`.
 */
export class TestPostgresRegistration {
  public register(alepha: Alepha, orm: Service): void {
    if (!alepha.isTest()) {
      throw new AlephaError(
        "AlephaOrmTestPostgres runs a spec on Postgres, and only in a test (NODE_ENV=test).",
      );
    }
    // A spec that names its own DATABASE_URL keeps it, as the URL always
    // decides: the module only fills one in.
    if (!(alepha.env as Record<string, unknown>).DATABASE_URL) {
      this.usePostgres(alepha);
    }
    // Registered here, where the spec put this module, as the module it
    // replaced did: a module registered after the ORM stops after it, and
    // a spec that travels in time relies on that order at stop.
    alepha.with(orm);
  }

  protected usePostgres(alepha: Alepha): void {
    const url = (alepha.env as Record<string, unknown>).POSTGRES_TEST_URL;
    if (typeof url !== "string" || url === "") {
      throw new AlephaError(
        "AlephaOrmTestPostgres needs POSTGRES_TEST_URL, the Postgres server specs run against (postgres://user:password@host:port/database).",
      );
    }
    // `loadEnv` clears the env cache, so a schema parsed before this module
    // still sees the URL.
    alepha.loadEnv({ DATABASE_URL: url });
    // Optional, as every driver choice is: a spec that substitutes its own
    // DatabaseProvider (a probe subclass) keeps it.
    alepha.with({
      optional: true,
      provide: DatabaseProvider,
      // postgres.js on every runtime, Bun included: this module sits in the
      // shared barrel, and `drizzle-orm/bun-sql` cannot be bundled for workerd.
      use: NodePostgresProvider,
    });
  }
}
