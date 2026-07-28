import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import type { PGlite } from "@electric-sql/pglite";
import { $env, $hook, $inject, AlephaError } from "alepha";
import { DatabaseProvider, databaseEnvSchema, type SQLLike } from "alepha/orm";
import { sql } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { postgresEnvSchema } from "../schemas/postgresEnvSchema.ts";
import { PostgresModelBuilder } from "../services/PostgresModelBuilder.ts";

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

  public override get schema(): string {
    return this.pgEnv.POSTGRES_SCHEMA ?? "public";
  }

  protected readonly env = $env(databaseEnvSchema);
  protected readonly pgEnv = $env(postgresEnvSchema);
  protected readonly builder = $inject(PostgresModelBuilder);

  protected client?: PGlite;
  protected pglite?: PgliteDatabase;

  public get name() {
    return "postgres";
  }

  public get driver() {
    return "pglite";
  }

  public override readonly dialect = "postgresql";

  public override get supportsTransactions(): boolean {
    return false;
  }

  public override get url(): string {
    let path = this.env.DATABASE_URL;

    if (!path) {
      if (this.alepha.isTest()) {
        path = ":memory:"; // use in-memory database for tests by default
      } else {
        path = "node_modules/.alepha/pglite"; // default path for dev
      }
    } else {
      if (path.includes(":memory:")) {
        // like postgres://:memory: or pglite://:memory:
        path = ":memory:";
      } else if (path.startsWith("file://")) {
        path = path.replace("file://", "");
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

  public override async execute(
    statement: SQLLike,
  ): Promise<Array<Record<string, unknown>>> {
    const { rows } = await this.db.execute(statement);
    return rows;
  }

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      if (Object.keys(this.kit.getModels(this)).length === 0) {
        return;
      }

      const module = PglitePostgresProvider.importPglite();
      if (!module) {
        throw new AlephaError(
          "@electric-sql/pglite is not installed. Please install it to use the pglite driver.",
        );
      }

      const { drizzle } = createRequire(import.meta.url)("drizzle-orm/pglite");
      const path = this.url;

      if (path !== ":memory:") {
        await mkdir(path, { recursive: true }).catch(() => null);
        this.client = new module.PGlite(path);
      } else {
        this.client = new module.PGlite();
      }

      this.pglite = drizzle({
        client: this.client,
      });

      await this.migrate();

      this.log.info(`Using PGlite database at ${path}`);
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

  protected override async runMigrator(
    migrationsFolder: string,
    options?: { init?: boolean },
  ): Promise<{ exitCode?: string } | void> {
    // Set search_path so schema-free migration SQL resolves to the correct schema.
    // PGlite uses a single connection, so SET persists through the migration.
    if (this.schema !== "public") {
      await this.db.execute(
        sql.raw(`SET search_path TO ${this.schema}, public`),
      );
    }
    return await migrate(this.db, {
      migrationsFolder,
      migrationsTable: this.migrationsTable,
      ...options,
    });
  }
}
