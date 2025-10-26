import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { $env, $hook, $inject, AlephaError, t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import type { PGlite } from "@electric-sql/pglite";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { PostgresModelBuilder } from "../../services/PostgresModelBuilder.ts";
import { DrizzleKitProvider } from "../DrizzleKitProvider.ts";
import { DatabaseProvider, type SQLLike } from "./DatabaseProvider.ts";

const envSchema = t.object({
  /**
   * Same as NodePostgresProvider connection string.
   * But, will accept only `file:` protocol for the database path.
   *
   * DATABASE_URL=memory://
   * DATABASE_URL=./db
   * DATABASE_URL=file://absolute/path/to/db
   */
  DATABASE_URL: t.optional(t.text()),
});

export interface PgLiteModule {
  PGlite: typeof PGlite;
}

export class PglitePostgresProvider extends DatabaseProvider {
  public static importPglite(): PgLiteModule | undefined {
    try {
      return createRequire(import.meta.url)("@electric-sql/pglite");
    } catch {
      // ignored
    }
  }

  protected readonly env = $env(envSchema);
  protected readonly log = $logger();
  protected readonly kit = $inject(DrizzleKitProvider);
  protected readonly builder = $inject(PostgresModelBuilder);

  protected client?: PGlite;
  protected pglite?: PgliteDatabase;

  public readonly dialect = "postgres";

  public override get db(): PgliteDatabase {
    if (!this.pglite) {
      throw new AlephaError("Database not initialized");
    }

    return this.pglite;
  }

  public async execute(
    statement: SQLLike,
  ): Promise<Array<Record<string, unknown>>> {
    const { rows } = await this.db.execute(statement);
    return rows;
  }

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      const module = PglitePostgresProvider.importPglite();
      if (!module) {
        throw new AlephaError(
          "@electric-sql/pglite is not installed. Please install it to use the pglite driver.",
        );
      }

      const { drizzle } = createRequire(import.meta.url)("drizzle-orm/pglite");
      const path = this.getDatabasePath();

      this.log.info(`Using PGlite database at ${path}`);

      if (path !== "memory://") {
        try {
          await mkdir(path, { recursive: true });
        } catch {}
      }

      this.client = new module.PGlite(this.getDatabasePath());
      this.pglite = drizzle({
        client: this.client,
      });
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: async () => {
      if (this.client) {
        this.log.debug("Closing PGlite connection...");
        await this.client.close();
        this.client = undefined;
        this.pglite = undefined;
        this.log.info("PGlite connection closed");
      }
    },
  });

  protected getDatabasePath(): string {
    let path = this.env.DATABASE_URL;

    if (!path) {
      if (this.alepha.isTest()) {
        path = "memory://"; // use in-memory database for tests by default
      } else {
        path = "node_modules/.db"; // default path for dev
      }
    } else {
      if (path.includes(":memory:")) {
        path = "memory://";
      } else if (path.startsWith("file://")) {
        path = path.replace("file://", "");
      }
    }

    return path;
  }
}
