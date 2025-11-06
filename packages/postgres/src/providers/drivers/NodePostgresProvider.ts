import { stat } from "node:fs/promises";
import {
  $env,
  $hook,
  $inject,
  Alepha,
  AlephaError,
  type Static,
  t,
} from "@alepha/core";
import { $lock } from "@alepha/lock";
import { $logger } from "@alepha/logger";
import { sql } from "drizzle-orm";
import type { MigrationConfig } from "drizzle-orm/migrator";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { PgMigrationError } from "../../errors/PgMigrationError.ts";
import { PostgresModelBuilder } from "../../services/PostgresModelBuilder.ts";
import { DrizzleKitProvider } from "../DrizzleKitProvider.ts";
import { DatabaseProvider, type SQLLike } from "./DatabaseProvider.ts";

declare module "@alepha/core" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

const envSchema = t.object({
  /**
   * Main configuration for database connection.
   * Accept a string in the format of a Postgres connection URL.
   * Example: postgres://user:password@localhost:5432/database
   * or
   * Example: postgres://user:password@localhost:5432/database?sslmode=require
   */
  DATABASE_URL: t.optional(t.text()),

  /**
   * In addition to the DATABASE_URL, you can specify the postgres schema name.
   *
   * It will monkey patch drizzle tables.
   */
  POSTGRES_SCHEMA: t.optional(t.text()),

  /**
   * Synchronize the database schema with the models.
   * It uses a custom implementation, it's not related to `drizzle-kit push` command.
   * It will generate the migration script and save it to the DB.
   *
   * This is recommended for development and testing purposes only.
   */
  POSTGRES_SYNCHRONIZE: t.optional(t.boolean()),
});

export interface NodePostgresProviderOptions {
  migrations: MigrationConfig;
  connection: postgres.Options<any>;
}

export class NodePostgresProvider extends DatabaseProvider {
  static readonly SSL_MODES = [
    "require",
    "allow",
    "prefer",
    "verify-full",
  ] as const;

  public readonly dialect = "postgres";

  protected readonly log = $logger();
  protected readonly env = $env(envSchema);
  protected readonly alepha = $inject(Alepha);
  protected readonly kit = $inject(DrizzleKitProvider);
  protected readonly builder = $inject(PostgresModelBuilder);
  protected client?: postgres.Sql;
  protected pg?: PostgresJsDatabase;

  public readonly options: NodePostgresProviderOptions = {
    migrations: this.getMigrationOptions(),
    connection: this.getClientOptions(),
  };

  /**
   * In testing mode, the schema name will be generated and deleted after the test.
   */
  protected schemaForTesting = this.alepha.isTest()
    ? this.env.POSTGRES_SCHEMA?.startsWith("test_")
      ? this.env.POSTGRES_SCHEMA
      : this.generateTestSchemaName()
    : undefined;

  public override execute(
    statement: SQLLike,
  ): Promise<Array<Record<string, unknown>>> {
    return this.db.execute(statement);
  }

  /**
   * Get Postgres schema.
   */
  public override get schema(): string {
    if (this.schemaForTesting) {
      return this.schemaForTesting;
    }

    if (this.env.POSTGRES_SCHEMA) {
      return this.env.POSTGRES_SCHEMA;
    }

    return "public";
  }

  public override get db(): PostgresJsDatabase {
    if (!this.pg) {
      throw new AlephaError("Database not initialized");
    }

    return this.pg;
  }

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      await this.connect();

      // never migrate in serverless mode (vercel, netlify, ...)
      if (!this.alepha.isServerless()) {
        try {
          await this.migrate.run();
        } catch (error) {
          throw new PgMigrationError(error);
        }
      }
    },
  });

  protected readonly onStop = $hook({
    on: "stop",
    handler: async () => {
      // cleanup test schema
      if (
        this.alepha.isTest() &&
        this.schemaForTesting &&
        this.schemaForTesting.startsWith("test_")
      ) {
        this.log.warn(`Deleting test schema '${this.schemaForTesting}' ...`);
        // I hope that this will never delete a production schema
        await this.execute(
          sql`DROP SCHEMA IF EXISTS "${sql.raw(this.schemaForTesting)}" CASCADE`,
        );
        this.log.info(`Test schema '${this.schemaForTesting}' deleted`);
      }

      // close the connection
      await this.close();
    },
  });

  public async connect(): Promise<void> {
    this.log.debug("Connect ..");

    const client = postgres(this.getClientOptions());
    await client`SELECT 1`; // test connection

    this.client = client;
    this.pg = drizzle(client, {
      logger: {
        // forward logs
        logQuery: (query: string, params: unknown[]) => {
          this.log.trace(query, { params });
        },
      },
    });

    this.log.info("Connection OK");
  }

  public async close(): Promise<void> {
    if (this.client) {
      this.log.debug("Close...");

      await this.client.end();

      this.client = undefined;
      this.pg = undefined;

      this.log.info("Connection closed");
    }
  }

  protected migrate = $lock({
    handler: async () => {
      const migration = this.getMigrationOptions();

      if (!this.alepha.isProduction()) {
        // -------------------------------------------------------------------------------------------------------------
        // Testing environment
        // -------------------------------------------------------------------------------------------------------------
        if (this.alepha.isTest()) {
          await this.kit.synchronize(this);
          return;
        }

        // -------------------------------------------------------------------------------------------------------------
        // Development environment
        // -------------------------------------------------------------------------------------------------------------

        // synchronize is TRUE in development mode
        if (this.env.POSTGRES_SYNCHRONIZE !== false) {
          try {
            // 1. silently run migrations
            await migrate(this.db, migration);
          } catch (_) {
            // ignore errors
          }

          // 2. synchronize the database schema with the models
          await this.kit.synchronize(this);
          return;
        }
      }

      this.log.debug(
        `Migrate from '${migration.migrationsFolder}' directory ...`,
      );

      const exists = await stat(migration.migrationsFolder).catch(() => false);
      if (!exists) {
        this.log.warn("Migration SKIPPED - no migrations found");
        return;
      }

      await migrate(this.db, migration);
      this.log.info("Migration OK");
    },
  });

  /**
   * Generate a minimal migration configuration.
   */
  protected getMigrationOptions(): MigrationConfig {
    return {
      migrationsFolder: "drizzle",
    };
  }

  /**
   * Map the DATABASE_URL to postgres client options.
   */
  protected getClientOptions(): postgres.Options<any> {
    if (!this.env.DATABASE_URL) {
      throw new AlephaError("DATABASE_URL is not defined in the environment");
    }

    const url = new URL(this.env.DATABASE_URL);

    return {
      host: url.hostname,
      user: decodeURIComponent(url.username),
      database: decodeURIComponent(url.pathname.replace("/", "")),
      password: decodeURIComponent(url.password),
      port: Number(url.port || 5432),
      ssl: this.ssl(url),
      onnotice: () => {
        // let drizzle handle logs
      },
    };
  }

  protected ssl(
    url: URL,
  ): "require" | "allow" | "prefer" | "verify-full" | undefined {
    const mode = url.searchParams.get("sslmode");
    for (const it of NodePostgresProvider.SSL_MODES) {
      if (mode === it) {
        return it;
      }
    }
  }

  /**
   * For testing purposes, generate a unique schema name.
   * The schema name will be generated based on the current date and time.
   * It will be in the format of `test_YYYYMMDD_HHMMSS_randomSuffix`.
   */
  protected generateTestSchemaName(): string {
    const pad = (n: number) => n.toString().padStart(2, "0");

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = pad(now.getUTCMonth() + 1);
    const day = pad(now.getUTCDate());
    const hours = pad(now.getUTCHours());
    const minutes = pad(now.getUTCMinutes());
    const seconds = pad(now.getUTCSeconds());

    const timestamp = `${year}${month}${day}_${hours}${minutes}${seconds}`;

    const randomSuffix = Math.random().toString(36).slice(2, 6); // 4 alphanumeric chars

    return `test_${timestamp}_${randomSuffix}`;
  }
}
