import { stat } from "node:fs/promises";
import {
  $inject,
  Alepha,
  AlephaError,
  type Static,
  type TObject,
} from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { type SQLWrapper, sql } from "drizzle-orm";
import {
  alias,
  type PgAsyncDatabase,
  type PgAsyncTransaction,
  type PgTableWithColumns,
} from "drizzle-orm/pg-core";
import type { PgTransactionConfig } from "drizzle-orm/pg-core/session";
import { DbError } from "../../errors/DbError.ts";
import type {
  EntityPrimitive,
  SchemaToTableConfig,
} from "../../primitives/$entity.ts";
import type { SequencePrimitive } from "../../primitives/$sequence.ts";
import { databaseEnvSchema } from "../../schemas/databaseEnvSchema.ts";
import type { ModelBuilder } from "../../services/ModelBuilder.ts";
import { DrizzleKitProvider } from "../DrizzleKitProvider.ts";

export type SQLLike = SQLWrapper | string;

export abstract class DatabaseProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly log = $logger();
  protected abstract readonly builder: ModelBuilder;
  protected readonly kit = $inject(DrizzleKitProvider);
  public abstract readonly db: PgAsyncDatabase<any>;

  /**
   * Open the driver's connection, for drivers that have an explicit one.
   *
   * Optional: sqlite-family drivers open lazily on first use and declare
   * neither. Callers use `provider.connect?.()` — the CLI used to reach for
   * `(provider as any).connect()` because the base class said nothing.
   */
  public connect?(): Promise<void>;

  /**
   * Close the driver's connection. Optional for the same reason as
   * {@link connect}.
   */
  public close?(): Promise<void>;
  public abstract readonly dialect: "postgresql" | "sqlite";
  public abstract readonly url: string;

  public readonly enums = new Map<string, unknown>();
  public readonly tables = new Map<string, unknown>();
  public readonly sequences = new Map<string, unknown>();
  public readonly schemas = new Map<string, unknown>();

  protected readonly entityPrimitives: EntityPrimitive[] = [];
  protected readonly sequencePrimitives: SequencePrimitive[] = [];

  public get name() {
    return "default";
  }

  public get driver(): string {
    return this.dialect;
  }

  /**
   * Whether this driver supports SQL-level transactions (BEGIN/COMMIT/ROLLBACK).
   *
   * Drivers that do not (e.g. PGlite, Cloudflare D1) should override to `false`.
   */
  public get supportsTransactions(): boolean {
    return true;
  }

  /**
   * Raw database connection handle (e.g. DatabaseSync, bun:sqlite Database).
   * Override in providers that expose native connections for introspection.
   */
  public get nativeConnection(): unknown {
    return undefined;
  }

  public get schema() {
    return "public";
  }

  /**
   * Migration tracking table name, scoped by schema.
   *
   * Returns `migrations_{schema}` so that multiple schemas sharing the same
   * database each get their own migration history (e.g. `migrations_lore`,
   * `migrations_public`).
   */
  public get migrationsTable(): string {
    return `migrations_${this.schema}`;
  }

  /**
   * Log a database query with structured metadata for devtools inspection.
   */
  protected logQuery(
    sql: string,
    params: unknown[],
    duration: number,
    rowCount: number,
    error?: string,
  ): void {
    const operation = this.parseOperation(sql);
    const data = {
      type: "db:query",
      sql,
      params,
      operation,
      duration: Math.round(duration * 100) / 100,
      rowCount,
      success: !error,
      error,
    };

    if (error) {
      this.log.warn(`Query failed (${operation})`, data);
    } else {
      this.log.debug(
        `Query OK (${operation}, ${Math.round(duration)}ms)`,
        data,
      );
    }
  }

  protected parseOperation(sql: string): string {
    const trimmed = sql.trimStart().toUpperCase();
    if (trimmed.startsWith("SELECT")) return "SELECT";
    if (trimmed.startsWith("INSERT")) return "INSERT";
    if (trimmed.startsWith("UPDATE")) return "UPDATE";
    if (trimmed.startsWith("DELETE")) return "DELETE";
    if (trimmed.startsWith("CREATE")) return "CREATE";
    if (trimmed.startsWith("ALTER")) return "ALTER";
    if (trimmed.startsWith("DROP")) return "DROP";
    return "OTHER";
  }

  public table<T extends TObject>(
    entity: EntityPrimitive<T>,
  ): PgTableWithColumns<SchemaToTableConfig<T>> {
    const table = this.tables.get(entity.name);
    if (!table) {
      throw new AlephaError(`Table '${entity.name}' is not registered`);
    }

    const hasAlias = (entity as any).$alias;

    if (hasAlias) {
      return alias(
        table as PgTableWithColumns<SchemaToTableConfig<T>>,
        hasAlias,
      ) as PgTableWithColumns<SchemaToTableConfig<T>>;
    }

    return table as PgTableWithColumns<SchemaToTableConfig<T>>;
  }

  public registerEntity(entity: EntityPrimitive) {
    this.entityPrimitives.push(entity);
    this.builder.buildTable(entity, this);
  }

  public registerSequence(sequence: SequencePrimitive) {
    this.sequencePrimitives.push(sequence);
    this.builder.buildSequence(sequence, this);
  }

  /**
   * Rebuild all models into fresh maps using a different schema.
   *
   * When called with `"public"`, produces schema-free models suitable for
   * migration generation (no schema qualifiers in the SQL output).
   */
  public rebuildModels(targetSchema: string): {
    tables: Map<string, unknown>;
    enums: Map<string, unknown>;
    sequences: Map<string, unknown>;
    schemas: Map<string, unknown>;
  } {
    const result = {
      tables: new Map<string, unknown>(),
      enums: new Map<string, unknown>(),
      sequences: new Map<string, unknown>(),
      schemas: new Map<string, unknown>(),
      schema: targetSchema,
    };

    for (const entity of this.entityPrimitives) {
      this.builder.buildTable(entity, result);
    }
    for (const seq of this.sequencePrimitives) {
      this.builder.buildSequence(seq, result);
    }

    return result;
  }

  /**
   * Run a function inside a database transaction with implicit tx propagation.
   *
   * The transaction object is stored in `alepha.store` so that all Repository
   * operations within `fn` automatically participate in the transaction without
   * explicit `{ tx }` drilling.
   *
   * Nesting is safe — if already inside a `transactional()` block, the inner
   * call reuses the outer transaction (no nested PG transactions / savepoints).
   */
  public async transactional<R>(
    fn: () => Promise<R>,
    config?: PgTransactionConfig,
  ): Promise<R> {
    const existing = this.alepha.get("alepha.orm.tx");
    if (existing) {
      return fn();
    }

    if (!this.supportsTransactions) {
      return fn();
    }

    return this.db.transaction(async (tx) => {
      this.alepha.store.set("alepha.orm.tx", tx as PgAsyncTransaction<any>, {
        skipEvents: true,
      });
      try {
        return await fn();
      } finally {
        this.alepha.store.set("alepha.orm.tx", undefined, { skipEvents: true });
      }
    }, config);
  }

  /**
   * Whether this driver runs `db.transaction()` through drizzle's synchronous
   * SQLite session. Sync sessions COMMIT as soon as the callback returns, so
   * an async callback would commit before its awaited work finishes; such
   * drivers must route transactions through the awaited `transactional()`
   * implementation instead.
   */
  public get usesSyncTransactions(): boolean {
    return false;
  }

  /**
   * Chain of pending native transactions — sync SQLite drivers share a single
   * connection, so BEGIN blocks must be serialized.
   */
  protected txMutex: Promise<unknown> = Promise.resolve();

  /**
   * Awaited BEGIN/COMMIT/ROLLBACK on a single shared native connection,
   * serialized so two concurrent contexts can't collide ("cannot start a
   * transaction within a transaction") or end each other's half-finished
   * transaction.
   */
  protected runExclusiveNativeTransaction<R>(
    exec: (sql: string) => void,
    fn: () => Promise<R>,
  ): Promise<R> {
    const run = async (): Promise<R> => {
      // Set the tx marker to the drizzle db itself — SQLite transactions are
      // connection-scoped, so all operations on this connection participate.
      this.alepha.store.set("alepha.orm.tx", this.db as any, {
        skipEvents: true,
      });
      exec("BEGIN");
      try {
        const result = await fn();
        exec("COMMIT");
        return result;
      } catch (error) {
        exec("ROLLBACK");
        throw error;
      } finally {
        this.alepha.store.set("alepha.orm.tx", undefined, {
          skipEvents: true,
        });
      }
    };

    const result = this.txMutex.then(run, run);
    this.txMutex = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  public abstract execute(
    statement: SQLLike,
  ): Promise<Record<string, unknown>[]>;

  public async run<T extends TObject>(
    statement: SQLLike,
    schema: T,
  ): Promise<Array<Static<T>>> {
    const result = await this.execute(statement);

    if (result == null) {
      return [];
    }

    if (!Array.isArray(result)) {
      this.log.error("Unexpected query result format", { result });
      throw new DbError(
        "Unexpected query result format, expected array of rows",
      );
    }

    return result.map((row) => this.alepha.codec.decode(schema, row));
  }

  /**
   * Get migrations folder path - can be overridden
   */
  protected getMigrationsFolder(): string {
    return `migrations/${this.name}`;
  }

  /**
   * Migration orchestration.
   *
   * - Production: file-based migrations from the migrations folder
   * - Dev / Test: push-based sync (introspects actual DB, no snapshots)
   * - Serverless: skipped (migrations should be applied during deployment)
   */
  public async migrate(): Promise<void> {
    if (this.alepha.isServerless()) {
      return;
    }

    if (this.alepha.isProduction()) {
      const migrationsFolder = this.getMigrationsFolder();
      const exists = await stat(migrationsFolder).catch(() => false);

      if (!exists) {
        this.log.warn("Migration SKIPPED - no migrations found");
        return;
      }

      // `drizzle-orm@1`'s migrator hard-throws a bare `Error` the instant it
      // finds `<folder>/meta/_journal.json` — the bookkeeping file every
      // pre-v1 drizzle-kit project has — naming `drizzle-kit up`, a command
      // Alepha users never run directly. The three apps in this repo were
      // baselined onto v1 as part of this upgrade, so that dead end is
      // invisible here, but it is a real backward-incompatibility for every
      // downstream consumer of `alepha` that has not yet baselined. Catch it
      // before it ever reaches drizzle's migrator and point at the actual
      // remedy instead of leaking drizzle's unreachable-for-us instruction.
      const legacyJournalExists = await stat(
        `${migrationsFolder}/meta/_journal.json`,
      )
        .then(() => true)
        .catch(() => false);

      if (legacyJournalExists) {
        throw new AlephaError(
          `'${migrationsFolder}' still uses drizzle-kit's pre-v1 migration layout ('meta/_journal.json'). Run 'alepha db baseline create' to collapse it into a single v1 migration, then 'alepha db baseline mark' (Cloudflare D1: 'alepha platform db baseline mark') to record it as applied without re-executing it.`,
        );
      }

      // For schema-free migrations, ensure the target schema exists
      // before running migration files. The schema is applied via
      // search_path set at the provider's connection level.
      if (this.dialect === "postgresql" && this.schema !== "public") {
        this.log.debug(`Ensuring schema '${this.schema}' exists ...`);
        await this.execute(
          sql`CREATE SCHEMA IF NOT EXISTS ${sql.raw(this.schema)}`,
        );
      }

      this.log.debug(`Migrate from '${migrationsFolder}' directory ...`);
      await this.executeMigrations(migrationsFolder);
      this.log.info("Migration OK");
    } else {
      const { DATABASE_SYNC } = this.alepha.parseEnv(databaseEnvSchema);
      if (DATABASE_SYNC === false) {
        this.log.info(
          "Database synchronization disabled (DATABASE_SYNC=false)",
        );
        return;
      }

      try {
        await this.kit.synchronize(this);
      } catch (error) {
        throw new DbError(
          `Failed to synchronize ${this.dialect} database schema`,
          error as Error,
        );
      }
    }
  }

  /**
   * Provider-specific migration execution.
   *
   * Default implementation delegates to {@link runMigrator}, the
   * driver-dispatch method shared with {@link markBaselineApplied}. Drivers
   * whose migration flow doesn't fit that shape — Cloudflare D1 and
   * Cloudflare Hyperdrive, both fully self-contained, error-wrapped flows
   * with no baseline-mark support (yet) — override this method directly
   * instead and never implement `runMigrator`.
   */
  protected async executeMigrations(migrationsFolder: string): Promise<void> {
    await this.runMigrator(migrationsFolder);
  }

  /**
   * Driver-specific dispatch to drizzle's `migrate()`, shared between the
   * normal migration path (via the default {@link executeMigrations}) and
   * {@link markBaselineApplied}. Implementations must pass
   * `{ migrationsFolder, ...options }` through to their driver's own
   * drizzle migrator import and return its result unchanged — that result
   * is how drizzle v1 reports the `init: true` guardrails back to the
   * caller.
   *
   * The base implementation throws; every runtime-migrator dialect
   * (Postgres, local SQLite, PGlite, Bun) overrides it. Cloudflare D1 and
   * Cloudflare Hyperdrive do not — they fully override
   * {@link executeMigrations} instead, so this default is only reachable
   * through {@link markBaselineApplied} for those two, which is why the
   * error names "baseline mark" rather than "migrations": D1 and Hyperdrive
   * both migrate fine through their own flows, they just don't support
   * baseline-mark's driver-dispatch shape yet.
   *
   * D1 now has a baseline-mark path — `WranglerApi.d1MigrationsBaseline`,
   * reachable via `alepha platform db baseline mark` — but it does not go
   * through this method at all (it drives wrangler's own bookkeeping table
   * directly, with no drizzle migrator involved). `alepha db baseline mark`
   * (the core command that calls `markBaselineApplied`) redirects D1
   * providers to that command before ever reaching here; this default throw
   * still guards a direct `provider.markBaselineApplied()` call and remains
   * accurate for Hyperdrive, which has no baseline-mark path anywhere yet.
   */
  protected async runMigrator(
    migrationsFolder: string,
    options?: { init?: boolean },
  ): Promise<{ exitCode?: string } | void> {
    if (this.driver === "d1") {
      throw new AlephaError(
        "D1 does not support baseline-mark through this method — use 'alepha platform db baseline mark', which drives wrangler's bookkeeping table directly.",
      );
    }
    throw new AlephaError(
      `'baseline mark' does not yet support the '${this.driver}' driver`,
    );
  }

  /**
   * Record the single baseline migration as applied WITHOUT executing it.
   *
   * Drizzle v1's migrator ships this natively: `init: true` inserts the
   * bookkeeping row and returns without running any SQL. It refuses when
   * the database already has migration rows (`databaseMigrations`) or when
   * more than one local migration exists (`localMigrations`), which is
   * exactly the invariant a baseline needs — adopting an existing database
   * into a fresh migration history must start from a clean bookkeeping
   * table and a single collapsed baseline file.
   */
  public async markBaselineApplied(migrationsFolder: string): Promise<void> {
    const result = await this.runMigrator(migrationsFolder, { init: true });

    if (result?.exitCode === "databaseMigrations") {
      throw new AlephaError(
        `Database already has migration rows. A baseline can only be recorded on a database with no migration history. Resetting an existing history is not yet supported for the '${this.driver}' driver — clear the migrations bookkeeping table manually first. (Cloudflare D1 supports this via 'alepha platform db baseline mark --reset'.)`,
      );
    }

    if (result?.exitCode === "localMigrations") {
      throw new AlephaError(
        "More than one local migration found. Run 'alepha db baseline create' first so exactly one baseline migration exists.",
      );
    }

    this.log.info(`Baseline recorded as applied for '${this.name}'`);
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * For testing purposes, generate a unique schema name.
   *
   * Format: `test_alepha_{epoch_seconds}_{random8}`
   * Example: `test_alepha_1739871618_k3m9x2p1`
   */
  protected generateTestSchemaName(): string {
    const epoch = Math.floor(this.dateTime.nowMillis() / 1000);
    const random = Math.random().toString(36).slice(2, 10).padEnd(8, "0");

    return `test_alepha_${epoch}_${random}`;
  }
}
