import { type Alepha, AlephaError, type Service } from "alepha";

import { DatabaseProvider } from "../providers/drivers/DatabaseProvider.ts";
import { NodePostgresProvider } from "../providers/drivers/NodePostgresProvider.ts";
import { DatabaseUrlParser } from "../services/DatabaseUrlParser.ts";

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

  /**
   * `DATABASE_TEST_DIALECT=postgres` (#Q3473): in a test, an unset or
   * in-memory SQLite `DATABASE_URL` becomes `POSTGRES_TEST_URL`, before the
   * ORM picks its driver. A file, D1 or Postgres URL is left alone, since a
   * spec naming one means it.
   */
  public applyDialectSwitch(alepha: Alepha): void {
    const env = alepha.env as Record<string, unknown>;
    if (!alepha.isTest() || env.DATABASE_TEST_DIALECT !== "postgres") {
      return;
    }
    const current =
      typeof env.DATABASE_URL === "string" ? env.DATABASE_URL : undefined;
    const parsed = new DatabaseUrlParser().parse(current);
    if (parsed && !(parsed.kind === "sqlite" && parsed.path === ":memory:")) {
      return;
    }
    this.usePostgres(alepha, { override: true });
  }

  protected usePostgres(
    alepha: Alepha,
    options: { override?: boolean } = {},
  ): void {
    const url = (alepha.env as Record<string, unknown>).POSTGRES_TEST_URL;
    if (typeof url !== "string" || url === "") {
      throw new AlephaError(
        "AlephaOrmTestPostgres needs POSTGRES_TEST_URL, the Postgres server specs run against (postgres://user:password@host:port/database).",
      );
    }
    if (options.override) {
      // `loadEnv` never replaces a key already set: drop it first.
      const { DATABASE_URL: _, ...rest } = alepha.env as Record<
        string,
        unknown
      >;
      alepha.store.set("env", rest as typeof alepha.env);
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
