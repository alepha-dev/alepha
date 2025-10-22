import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  $env,
  $hook,
  $inject,
  AlephaError,
  type Static,
  type TObject,
  t,
} from "@alepha/core";
import { $logger } from "@alepha/logger";
import type { PGlite } from "@electric-sql/pglite";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { DrizzleKitProvider } from "../DrizzleKitProvider.ts";
import { PostgresProvider, type SQLLike } from "./PostgresProvider.ts";

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

export class PglitePostgresProvider extends PostgresProvider {
  public static importPglite():
    | {
        PGlite: typeof PGlite;
      }
    | undefined {
    try {
      return createRequire(import.meta.url)("@electric-sql/pglite");
    } catch {}
  }

  protected readonly env = $env(envSchema);

  protected readonly log = $logger();

  protected client?: PGlite;
  protected pglite?: PgliteDatabase;

  protected readonly kit = $inject(DrizzleKitProvider);

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

      await this.kit.synchronize(this, this.schema);
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

  public async execute<T extends TObject | undefined>(
    query: SQLLike,
    schema?: T,
  ): Promise<Array<T extends TObject ? Static<T> : any>> {
    const response = await this.db.execute(query);

    if (schema) {
      return this.mapResult(response.rows, schema);
    }

    return response.rows as Array<T extends TObject ? Static<T> : any>;
  }

  protected getDatabasePath(): string {
    let path = this.env.DATABASE_URL;
    if (!path) {
      if (this.alepha.isTest()) {
        path = "memory://";
      } else {
        path = "node_modules/.db";
      }
    } else {
      if (path === ":memory:") {
        path = "memory://";
      } else if (path.startsWith("file://")) {
        path = path.replace("file://", "");
      } else if (path.startsWith("postgres://")) {
        throw new AlephaError(
          "Invalid DATABASE_URL. postgres:// protocol are not supported by PGlite.",
        );
      }
    }
    return path;
  }

  public override get db(): PgliteDatabase {
    if (!this.pglite) {
      throw new AlephaError("Database not initialized");
    }

    return this.pglite;
  }
}
