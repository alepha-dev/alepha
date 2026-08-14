import { $env, $hook, $inject, $pipeline, AlephaError } from "alepha";
import { $lock } from "alepha/lock";
import {
  DatabaseProvider,
  DbMigrationError,
  databaseEnvSchema,
  type SQLLike,
} from "alepha/orm";
import { sql } from "drizzle-orm";
import type { PgAsyncDatabase } from "drizzle-orm/pg-core";
import { postgresEnvSchema } from "../schemas/postgresEnvSchema.ts";
import { PostgresModelBuilder } from "../services/PostgresModelBuilder.ts";

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
 * Subclasses must implement `connect()`, `close()`, and `runMigrator()`.
 */
export abstract class PostgresProvider extends DatabaseProvider {
  protected readonly env = $env(databaseEnvSchema);
  protected readonly pgEnv = $env(postgresEnvSchema);
  protected readonly builder = $inject(PostgresModelBuilder);

  public override readonly dialect = "postgresql";

  public get name() {
    return "postgres";
  }

  /**
   * In testing mode, the schema name will be generated and deleted after the test.
   */
  protected schemaForTesting = this.alepha.isTest()
    ? this.generateTestSchemaName()
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
  public override async execute(
    statement: SQLLike,
  ): Promise<Array<Record<string, unknown>>> {
    return await this.db.execute(statement);
  }

  /**
   * Get Postgres schema used by this provider.
   */
  public override get schema(): string {
    if (this.schemaForTesting) {
      return this.schemaForTesting;
    }

    if (this.pgEnv.POSTGRES_SCHEMA) {
      return this.pgEnv.POSTGRES_SCHEMA;
    }

    return "public";
  }

  public abstract override get db(): PgAsyncDatabase<any>;

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
      await this.dropTestSchema();
      await this.close();
    },
  });

  protected migrateLock = $pipeline({
    use: [$lock({ name: "postgres:migrate" })],
    handler: async () => {
      await this.migrate();
    },
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Create unique schema for tests and clean up after. Format: test_alepha_{epoch_seconds}_{random8}
  // -------------------------------------------------------------------------------------------------------------------

  protected async generateTestSchema() {
    if (
      this.alepha.isTest() &&
      this.schemaForTesting?.startsWith("test_alepha_")
    ) {
      // Self-healing: drop stale schemas left behind by crashed/failed test runs
      await this.cleanupStaleTestSchemas();

      await this.execute(
        sql`CREATE SCHEMA IF NOT EXISTS ${sql.raw(this.schemaForTesting)}`,
      );
    }
  }

  /**
   * Drop the current test schema if applicable.
   *
   * Retries on a Postgres deadlock (40P01): background work that outran
   * the stop-time drains — an unawaited cron catch-up from `travel()`,
   * a fire-and-forget dispatch — can still hold an AccessShare lock on a
   * table while the CASCADE wants AccessExclusive. Postgres kills one
   * side, the straggler dies with the app a beat later, and a retry
   * succeeds. Failing the whole test file over cleanup of a
   * one-run-only schema is the worse trade.
   */
  protected async dropTestSchema(): Promise<void> {
    if (
      this.alepha.isTest() &&
      this.schemaForTesting?.startsWith("test_alepha_")
    ) {
      this.log.info(`Deleting test schema '${this.schemaForTesting}' ...`);
      for (let attempt = 1; ; attempt++) {
        try {
          await this.execute(
            sql`DROP SCHEMA IF EXISTS ${sql.raw(this.schemaForTesting)} CASCADE`,
          );
          break;
        } catch (error) {
          const code = (error as { cause?: { code?: string } })?.cause?.code;
          if (code !== "40P01" || attempt >= 3) {
            throw error;
          }
          this.log.warn(
            `Deadlock dropping test schema (attempt ${attempt}), retrying`,
          );
          await new Promise((r) => setTimeout(r, 100 * attempt));
        }
      }
      this.log.info(`Test schema '${this.schemaForTesting}' deleted`);
    }
  }

  /**
   * Remove stale test schemas older than 1 hour.
   *
   * Parses the embedded epoch from schema names (format: test_alepha_{epoch}_{random8})
   * and drops any that exceed the TTL. This handles schemas left behind by crashed tests,
   * killed processes, or failed startups where stop() never fired.
   *
   * Uses a PG advisory lock so only one concurrent test process performs the cleanup.
   */
  protected async cleanupStaleTestSchemas(): Promise<void> {
    try {
      // Non-blocking advisory lock — first process in cleans, others skip
      const [lock] = await this.execute(
        sql`SELECT pg_try_advisory_lock(hashtext('alepha:test:schema:cleanup')) AS acquired`,
      );

      if (!lock?.acquired) {
        return;
      }

      try {
        const result = await this.execute(
          sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'test_alepha_%'`,
        );

        const now = this.dateTime.nowMillis();
        const maxAge = 60 * 60 * 1000; // 1 hour

        for (const row of result) {
          const name = row.schema_name as string;

          // Skip our own schema (it was just created or is about to be)
          if (name === this.schemaForTesting) {
            continue;
          }

          const age = this.parseTestSchemaAge(name, now);
          if (age !== undefined && age > maxAge) {
            this.log.warn(
              `Dropping stale test schema '${name}' (age: ${Math.round(age / 60_000)}min) ...`,
            );
            await this.execute(
              sql`DROP SCHEMA IF EXISTS ${sql.raw(name)} CASCADE`,
            );
          }
        }
      } finally {
        await this.execute(
          sql`SELECT pg_advisory_unlock(hashtext('alepha:test:schema:cleanup'))`,
        );
      }
    } catch (error) {
      // Don't fail test setup if stale cleanup fails
      this.log.warn("Failed to clean up stale test schemas", { error });
    }
  }

  /**
   * Parse the age in milliseconds from a test schema name.
   * Format: test_alepha_{epoch_seconds}_{random8}
   * Returns undefined if the name doesn't match the expected format.
   */
  protected parseTestSchemaAge(name: string, now: number): number | undefined {
    const parts = name.split("_");
    // test_alepha_{epoch}_{random} → ["test", "alepha", epoch, random]
    if (parts.length !== 4 || parts[0] !== "test" || parts[1] !== "alepha") {
      return undefined;
    }

    const epoch = Number(parts[2]);
    if (!Number.isFinite(epoch) || epoch <= 0) {
      return undefined;
    }

    return now - epoch * 1000;
  }
}
