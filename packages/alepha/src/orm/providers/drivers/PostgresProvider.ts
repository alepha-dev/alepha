import {
  $env,
  $hook,
  $inject,
  $pipeline,
  AlephaError,
  type Static,
  t,
} from "alepha";
import { $lock } from "alepha/lock";
import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { DbError } from "../../errors/DbError.ts";
import { DbMigrationError } from "../../errors/DbMigrationError.ts";
import { PostgresModelBuilder } from "../../services/PostgresModelBuilder.ts";
import { DatabaseProvider, type SQLLike } from "./DatabaseProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

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
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Abstract base class for PostgreSQL database providers.
 *
 * Provides shared logic for Node.js and Bun PostgreSQL providers:
 * - Environment variable handling (DATABASE_URL, POSTGRES_SCHEMA)
 * - Schema name resolution (with test schema generation)
 * - SQL execution with error wrapping
 * - Lifecycle hooks (start with migration lock, stop with test cleanup)
 *
 * Subclasses must implement `connect()`, `close()`, and `executeMigrations()`.
 */
export abstract class PostgresProvider extends DatabaseProvider {
  protected readonly env = $env(envSchema);
  protected readonly builder = $inject(PostgresModelBuilder);

  public override readonly dialect = "postgresql";

  public get name() {
    return "postgres";
  }

  /**
   * In testing mode, the schema name will be generated and deleted after the test.
   */
  protected schemaForTesting = this.alepha.isTest()
    ? this.env.POSTGRES_SCHEMA?.startsWith("test_")
      ? this.env.POSTGRES_SCHEMA
      : this.generateTestSchemaName()
    : undefined;

  public override get url() {
    if (!this.env.DATABASE_URL) {
      throw new AlephaError("DATABASE_URL is not defined in the environment");
    }

    return this.env.DATABASE_URL;
  }

  /**
   * Execute a SQL statement.
   */
  public override execute(
    statement: SQLLike,
  ): Promise<Array<Record<string, unknown>>> {
    try {
      return this.db.execute(statement);
    } catch (error) {
      throw new DbError("Error executing statement", error);
    }
  }

  /**
   * Get Postgres schema used by this provider.
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

  public abstract override get db(): PgDatabase<any>;

  /**
   * Establish the database connection.
   */
  public abstract connect(): Promise<void>;

  /**
   * Close the database connection.
   */
  public abstract close(): Promise<void>;

  // -------------------------------------------------------------------------------------------------------------------

  protected readonly onStart = $hook({
    on: "start",
    handler: async () => {
      await this.connect();
      await this.generateTestSchema();

      // never migrate in serverless mode (vercel, netlify, ...)
      if (!this.alepha.isServerless()) {
        try {
          await this.migrateLock.run();
        } catch (error) {
          throw new DbMigrationError(error);
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
        // Additional validation: schema name must only contain safe characters
        if (!/^test_[a-z0-9_]+$/i.test(this.schemaForTesting)) {
          throw new AlephaError(
            `Invalid test schema name: ${this.schemaForTesting}. Must match pattern: test_[a-z0-9_]+`,
          );
        }

        this.log.warn(`Deleting test schema '${this.schemaForTesting}' ...`);
        // Use sql.raw without quotes (Drizzle handles identifier escaping)
        await this.execute(
          sql`DROP SCHEMA IF EXISTS ${sql.raw(this.schemaForTesting)} CASCADE`,
        );
        this.log.info(`Test schema '${this.schemaForTesting}' deleted`);
      }

      // close the connection
      await this.close();
    },
  });

  protected migrateLock = $pipeline({
    use: [$lock({ name: "postgres:migrate" })],
    handler: async () => {
      await this.migrate();
    },
  });

  protected async generateTestSchema() {
    if (
      this.alepha.isTest() &&
      this.schemaForTesting &&
      this.schemaForTesting.startsWith("test_")
    ) {
      // Additional validation: schema name must only contain safe characters
      if (!/^test_[a-z0-9_]+$/i.test(this.schemaForTesting)) {
        throw new AlephaError(
          `Invalid test schema name: ${this.schemaForTesting}. Must match pattern: test_[a-z0-9_]+`,
        );
      }

      await this.execute(
        sql`CREATE SCHEMA IF NOT EXISTS ${sql.raw(this.schemaForTesting)}`,
      );
    }
  }
}
