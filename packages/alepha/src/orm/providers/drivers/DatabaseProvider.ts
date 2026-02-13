import { stat } from "node:fs/promises";
import {
  $inject,
  Alepha,
  AlephaError,
  type Static,
  type TObject,
} from "alepha";
import { $logger } from "alepha/logger";
import type { SQLWrapper } from "drizzle-orm";
import {
  alias,
  type PgDatabase,
  type PgTableWithColumns,
} from "drizzle-orm/pg-core";
import type { PgTransactionConfig } from "drizzle-orm/pg-core/session";
import { DbError } from "../../errors/DbError.ts";
import type {
  EntityPrimitive,
  SchemaToTableConfig,
} from "../../primitives/$entity.ts";
import type { SequencePrimitive } from "../../primitives/$sequence.ts";
import type { ModelBuilder } from "../../services/ModelBuilder.ts";
import { DrizzleKitProvider } from "../DrizzleKitProvider.ts";

export type SQLLike = SQLWrapper | string;

export abstract class DatabaseProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected abstract readonly builder: ModelBuilder;
  protected readonly kit = $inject(DrizzleKitProvider);
  public abstract readonly db: PgDatabase<any>;
  public abstract readonly dialect: "postgresql" | "sqlite";
  public abstract readonly url: string;

  public readonly enums = new Map<string, unknown>();
  public readonly tables = new Map<string, unknown>();
  public readonly sequences = new Map<string, unknown>();

  public get name() {
    return "default";
  }

  public get driver(): string {
    return this.dialect;
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
    this.builder.buildTable(entity, this);
  }

  public registerSequence(sequence: SequencePrimitive) {
    this.builder.buildSequence(sequence, this);
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
    const existing = this.alepha.store.get("tx" as any);
    if (existing) {
      return fn();
    }

    return this.db.transaction(async (tx) => {
      this.alepha.store.set("tx" as any, tx, { skipEvents: true });
      try {
        return await fn();
      } finally {
        this.alepha.store.set("tx" as any, undefined, { skipEvents: true });
      }
    }, config);
  }

  public abstract execute(
    statement: SQLLike,
  ): Promise<Record<string, unknown>[]>;

  public async run<T extends TObject>(
    statement: SQLLike,
    schema: T,
  ): Promise<Array<Static<T>>> {
    const result = await this.execute(statement);
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

      this.log.debug(`Migrate from '${migrationsFolder}' directory ...`);
      await this.executeMigrations(migrationsFolder);
      this.log.info("Migration OK");
    } else {
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
   * Provider-specific migration execution
   * MUST be implemented by each provider
   */
  protected abstract executeMigrations(migrationsFolder: string): Promise<void>;

  // -------------------------------------------------------------------------------------------------------------------

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
