import { $env, $hook, $inject, AlephaError } from "alepha";
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
  /**
   * @internal Driver plumbing, outside semver.
   */
  protected readonly builder = $inject(PostgresModelBuilder);

  public override readonly dialect = "postgresql";

  /**
   * The wire protocol carries the parameter count as a 16-bit integer.
   */
  public override readonly maxBoundParameters = 65535;

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
    // On the open transaction's handle when there is one, like every
    // repository method: on the pool, a raw statement inside
    // \`$transactional\` committed on its own connection and survived the
    // rollback.
    return await this.executor.execute(statement);
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

  /**
   * @internal Driver plumbing, outside semver.
   */
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
          await this.migrateUnderLock();
        } catch (error) {
          throw new DbMigrationError(undefined, { cause: error });
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

  /**
   * How long a booting instance waits, in milliseconds, for another one that
   * is migrating the same schema. Past it the boot fails with a
   * `DbMigrationError` naming the lock, rather than hanging on a stuck
   * migration.
   */
  protected readonly migrationLockTimeout: number = 300_000;

  /**
   * The advisory lock key, per schema: two apps on one database but in two
   * schemas (and every test container, each in its own schema) never wait
   * for each other.
   */
  protected get migrationLockKey(): string {
    return `alepha:migrate:${this.schema}`;
  }

  /**
   * A session of its own for the migration lock, or `undefined` when the
   * driver cannot pin one (the migration then runs unlocked, as on SQLite).
   *
   * A Postgres advisory lock belongs to the SESSION that took it, so taking
   * and releasing it on a pool could land on two different connections.
   */
  protected async openLockSession(): Promise<PostgresLockSession | undefined> {
    return undefined;
  }

  /**
   * Migrate while holding `pg_advisory_lock` on a session of its own.
   *
   * A second instance booting while the first migrates WAITS for the lock,
   * then finds the migrations applied. It used to take a `$lock` with
   * `wait: false` and crash its boot on `LockAcquireError`; and that lock went
   * through `LockProvider`, in memory unless Redis was configured, so two
   * instances without Redis took two locks and migrated at once. The database
   * is the one thing they share, so the lock lives there.
   *
   * The wait is bounded by `lock_timeout` ({@link migrationLockTimeout}),
   * reset before migrating so the migration's own statements are not bound
   * by it. The lock is released in `finally`, and closing the session
   * releases it anyway.
   */
  protected async migrateUnderLock(): Promise<void> {
    const session = await this.openLockSession();
    if (!session) {
      await this.migrate();
      return;
    }

    const key = this.migrationLockKey;
    try {
      await session.query(
        `SET lock_timeout = ${Math.max(1, Math.round(this.migrationLockTimeout))}`,
      );
      try {
        await session.query("SELECT pg_advisory_lock(hashtext($1))", [key]);
      } catch (error) {
        throw new AlephaError(
          `Could not take the migration lock '${key}' within ${this.migrationLockTimeout} ms: another instance is still migrating this schema, or holds the lock`,
          { cause: error },
        );
      }
      await session.query("SET lock_timeout = 0");

      try {
        await this.migrate();
      } finally {
        await session.query("SELECT pg_advisory_unlock(hashtext($1))", [key]);
      }
    } finally {
      await session.close();
    }
  }

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

// ---------------------------------------------------------------------------------------------------------------------

/**
 * One pinned Postgres session, used to hold the migration advisory lock.
 *
 * @see PostgresProvider.migrateUnderLock
 */
export interface PostgresLockSession {
  query(text: string, params?: unknown[]): Promise<unknown>;
  close(): Promise<void>;
}
