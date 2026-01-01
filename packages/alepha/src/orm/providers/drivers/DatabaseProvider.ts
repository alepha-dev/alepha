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
import { DbError } from "../../errors/DbError.ts";
import type {
  EntityPrimitive,
  SchemaToTableConfig,
} from "../../primitives/$entity.ts";
import type { SequencePrimitive } from "../../primitives/$sequence.ts";
import type { ModelBuilder } from "../../services/ModelBuilder.ts";
import type { DrizzleKitProvider } from "../DrizzleKitProvider.ts";

export type SQLLike = SQLWrapper | string;

export abstract class DatabaseProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected abstract readonly builder: ModelBuilder;
  protected abstract readonly kit: DrizzleKitProvider;
  public abstract readonly db: PgDatabase<any>;
  public abstract readonly dialect: "postgresql" | "sqlite";
  public abstract readonly url: string;

  public readonly enums = new Map<string, unknown>();
  public readonly tables = new Map<string, unknown>();
  public readonly sequences = new Map<string, unknown>();

  public get name() {
    return "default";
  }

  public get schema() {
    return "public";
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
   * Base migration orchestration - handles environment logic
   */
  protected async migrateDatabase(): Promise<void> {
    const migrationsFolder = this.getMigrationsFolder();

    // Handle different environments
    if (this.alepha.isProduction()) {
      await this.runProductionMigration(migrationsFolder);
    } else if (this.alepha.isTest()) {
      await this.runTestMigration();
    } else {
      await this.runDevelopmentMigration(migrationsFolder);
    }
  }

  /**
   * Production: run migrations from folder
   */
  protected async runProductionMigration(
    migrationsFolder: string,
  ): Promise<void> {
    // Check folder exists
    const exists = await stat(migrationsFolder).catch(() => false);

    if (!exists) {
      this.log.warn("Migration SKIPPED - no migrations found");
      return;
    }

    this.log.debug(`Migrate from '${migrationsFolder}' directory ...`);

    // Delegate to provider-specific implementation
    await this.executeMigrations(migrationsFolder);

    this.log.info("Migration OK");
  }

  /**
   * Test: always synchronize
   */
  protected async runTestMigration(): Promise<void> {
    await this.synchronizeSchema();
  }

  /**
   * Development: default to synchronize (can be overridden)
   */
  protected async runDevelopmentMigration(
    migrationsFolder: string,
  ): Promise<void> {
    // try migrations silently first
    try {
      // exclude in-memory databases (there is nothing to migrate!)
      if (!this.url.includes(":memory:")) {
        await this.executeMigrations(migrationsFolder);
      }
    } catch {
      // Ignore errors
    }

    // then synchronize
    await this.synchronizeSchema();
  }

  /**
   * Common synchronization with error handling
   */
  protected async synchronizeSchema(): Promise<void> {
    try {
      await this.kit.synchronize(this);
    } catch (error) {
      throw new DbError(
        `Failed to synchronize ${this.dialect} database schema`,
        error as Error,
      );
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
