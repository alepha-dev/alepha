import { createRequire } from "node:module";
import { $inject, Alepha, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import type * as DrizzleKit from "drizzle-kit/api";
import { sql } from "drizzle-orm";
import type { DatabaseProvider } from "./drivers/DatabaseProvider.ts";

export class DrizzleKitProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);

  /**
   * Push-based synchronization using Drizzle Kit's introspection API.
   *
   * Reads the actual database state, diffs against current entity definitions,
   * and applies changes. No stored snapshots — no drift, no corruption.
   *
   * - SQLite: uses `pushSQLiteSchema` (requires better-sqlite3 or bun-sqlite driver)
   * - PostgreSQL: uses `pushSchema` with schema filters
   *
   * Does nothing in production mode — use file-based migrations instead.
   */
  public async synchronize(provider: DatabaseProvider): Promise<void> {
    if (this.alepha.isProduction()) {
      this.log.warn("Synchronization skipped in production mode.");
      return;
    }

    if (this.alepha.isTest()) {
      // In test mode, we want to generate migrations from scratch (no snapshots)
      // to ensure the generated SQL is correct and can be applied cleanly.
      const { statements } = await this.generateMigration(provider);
      await this.executeFallbackStatements(statements, provider);
      return;
    }

    const now = Date.now();
    const kit = this.importDrizzleKit();
    const models = this.getModels(provider);

    if (Object.keys(models).length === 0) {
      this.log.info(`No models to synchronize for '${provider.name}'`);
      return;
    }

    try {
      if (provider.dialect === "sqlite") {
        await this.pushSqlite(kit, models, provider);
      } else {
        await this.pushPostgres(kit, models, provider);
      }
    } catch (error) {
      // Fallback: generate migrations from scratch (no snapshots)
      // Covers drivers that don't support introspection (e.g. PgLite, sqlite-proxy)
      this.log.debug(
        "Push sync not available, falling back to migration generation",
        { error },
      );
      const { statements } = await this.generateMigration(provider);
      await this.executeFallbackStatements(statements, provider);
    }

    this.log.info(`Sync with '${provider.name}' OK [${Date.now() - now}ms]`);
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Generate SQL migration statements by diffing two schema states.
   *
   * Used by tests (schema validation) and CLI (`alepha db generate`).
   * Not part of the push sync flow.
   */
  public async generateMigration(
    provider: DatabaseProvider,
    prevSnapshot?: any,
  ): Promise<{
    statements: string[];
    models: Record<string, unknown>;
    snapshot?: any;
  }> {
    const kit = this.importDrizzleKit();
    const models = this.getModels(provider);

    if (Object.keys(models).length > 0) {
      if (provider.dialect === "sqlite") {
        const prev = prevSnapshot ?? (await kit.generateSQLiteDrizzleJson({}));
        const curr = await kit.generateSQLiteDrizzleJson(models);
        return {
          models,
          statements: await kit.generateSQLiteMigration(prev, curr),
          snapshot: curr,
        };
      }

      const prev = prevSnapshot ?? kit.generateDrizzleJson({});
      const curr = kit.generateDrizzleJson(models);
      return {
        models,
        statements: await kit.generateMigration(prev, curr),
        snapshot: curr,
      };
    }

    return {
      models,
      statements: [],
      snapshot: {},
    };
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Load all tables, enums, sequences, etc. from the provider's repositories.
   */
  public getModels(provider: DatabaseProvider): Record<string, unknown> {
    const models: Record<string, unknown> = {};
    for (const [key, value] of provider.tables.entries()) {
      if (models[key]) {
        throw new AlephaError(
          `Model name conflict: '${key}' is already defined.`,
        );
      }
      models[key] = value;
    }
    for (const [key, value] of provider.enums.entries()) {
      if (models[key]) {
        throw new AlephaError(
          `Model name conflict: '${key}' is already defined.`,
        );
      }
      models[key] = value;
    }
    for (const [key, value] of provider.sequences.entries()) {
      if (models[key]) {
        throw new AlephaError(
          `Model name conflict: '${key}' is already defined.`,
        );
      }
      models[key] = value;
    }
    return models;
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected async pushSqlite(
    kit: typeof DrizzleKit,
    models: Record<string, unknown>,
    provider: DatabaseProvider,
  ): Promise<void> {
    const result = await this.muteSpinner(() =>
      kit.pushSQLiteSchema(models, provider.db as any),
    );

    if (result.hasDataLoss) {
      this.log.warn("Push would cause data loss", {
        warnings: result.warnings,
        statements: result.statementsToExecute,
      });
    }

    if (result.statementsToExecute.length > 0) {
      this.log.debug(
        `Pushing ${result.statementsToExecute.length} statements ...`,
        { statements: result.statementsToExecute },
      );
      await this.muteSpinner(() => result.apply());
    }
  }

  protected async pushPostgres(
    kit: typeof DrizzleKit,
    models: Record<string, unknown>,
    provider: DatabaseProvider,
  ): Promise<void> {
    if (provider.schema !== "public") {
      await this.createSchemaIfNotExists(provider, provider.schema);
    }

    const result = await this.muteSpinner(() =>
      kit.pushSchema(models, provider.db, [provider.schema]),
    );

    if (result.hasDataLoss) {
      this.log.warn("Push would cause data loss", {
        warnings: result.warnings,
        statements: result.statementsToExecute,
      });
    }

    if (result.statementsToExecute.length > 0) {
      this.log.debug(
        `Pushing ${result.statementsToExecute.length} statements ...`,
        { statements: result.statementsToExecute },
      );
      await this.muteSpinner(() => result.apply());
    }
  }

  /**
   * Execute migration statements as a fallback when push sync is not available.
   * Used for drivers that don't support Drizzle Kit introspection (e.g. PgLite).
   */
  protected async executeFallbackStatements(
    statements: string[],
    provider: DatabaseProvider,
  ): Promise<void> {
    for (const statement of statements) {
      if (statement.startsWith("DROP SCHEMA")) {
        continue;
      }
      await provider.execute(sql.raw(statement));
    }
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected async createSchemaIfNotExists(
    provider: DatabaseProvider,
    schemaName: string,
  ) {
    if (!/^[a-z0-9_]+$/i.test(schemaName)) {
      throw new AlephaError(
        `Invalid schema name: ${schemaName}. Must only contain alphanumeric characters and underscores.`,
      );
    }

    const sqlSchema = sql.raw(schemaName);

    if (schemaName.startsWith("test_")) {
      this.log.info(`Drop test schema '${schemaName}' ...`, schemaName);
      await provider.execute(sql`DROP SCHEMA IF EXISTS ${sqlSchema} CASCADE`);
    }

    this.log.debug(`Ensuring schema '${schemaName}' exists`);
    await provider.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sqlSchema}`);
  }

  /**
   * Suppress Drizzle Kit's spinner output during a callback.
   *
   * Only filters the "Pulling schema from database..." spinner lines.
   * Other output (e.g. confirmation prompts for destructive changes) passes through.
   */
  protected async muteSpinner<T>(fn: () => Promise<T>): Promise<T> {
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: any, ...args: any[]) => {
      const str =
        typeof chunk === "string" ? chunk : (chunk?.toString?.() ?? "");
      if (str.includes("Pulling schema from database")) {
        return true;
      }
      return (originalWrite as any).call(process.stdout, chunk, ...args);
    };
    try {
      return await fn();
    } finally {
      process.stdout.write = originalWrite;
    }
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Try to load the official Drizzle Kit API.
   */
  public importDrizzleKit(): typeof DrizzleKit {
    try {
      return createRequire(import.meta.url)("drizzle-kit/api");
    } catch (_) {
      throw new AlephaError(
        "Drizzle Kit is not installed. Please install it with `npm install -D drizzle-kit`.",
      );
    }
  }
}
