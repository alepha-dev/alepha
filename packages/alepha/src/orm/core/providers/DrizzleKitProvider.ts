import { createRequire } from "node:module";
import { $inject, Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import type * as DrizzleKit from "drizzle-kit/api";
import { sql } from "drizzle-orm";
import type { DatabaseProvider } from "./drivers/DatabaseProvider.ts";

export class DrizzleKitProvider {
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly alepha = $inject(Alepha);

  /**
   * Push-based synchronization using Drizzle Kit's introspection API.
   *
   * Reads the actual database state, diffs against current entity definitions,
   * and applies changes. No stored snapshots — no drift, no corruption.
   *
   * - SQLite: uses `pushSQLiteSchema` (requires sync driver — node:sqlite shim or bun-sqlite)
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
      const { statements } = await this.generateMigration(provider);
      await this.executeStatements(
        statements.map((s) =>
          s.replace(/^CREATE SCHEMA /i, "CREATE SCHEMA IF NOT EXISTS "),
        ),
        provider,
      );
      return;
    }

    const now = this.dateTime.nowMillis();
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
      // Fallback: generate migrations from scratch (no snapshots).
      // Covers drivers that don't support introspection (e.g. PgLite, sqlite-proxy).
      //
      // If push partially executed (e.g. interactive rename applied then errored),
      // the fallback would re-create tables that already exist. Guard against this
      // by attempting the statements individually and ignoring "already exists" errors.
      this.log.debug(
        "Push sync not available, falling back to migration generation",
        { error },
      );
      const { statements } = await this.generateMigration(provider);
      await this.executeStatementsLenient(statements, provider);
    }

    this.log.info(
      `Synchronization of '${provider.name}' OK [${this.dateTime.nowMillis() - now}ms]`,
    );
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Generate SQL migration statements by diffing two schema states.
   *
   * Used by tests (schema validation) and CLI (`alepha db migrations generate`).
   * Not part of the push sync flow.
   *
   * When `withoutSchema` is true, models are rebuilt without schema qualifiers
   * so the generated SQL is portable across different PostgreSQL schemas.
   */
  public async generateMigration(
    provider: DatabaseProvider,
    prevSnapshot?: any,
    options?: { withoutSchema?: boolean },
  ): Promise<{
    statements: string[];
    models: Record<string, unknown>;
    snapshot?: any;
  }> {
    const kit = this.importDrizzleKit();
    const models = options?.withoutSchema
      ? this.getModelsWithoutSchema(provider)
      : this.getModels(provider);

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

    for (const [key, value] of provider.schemas.entries()) {
      models[`__schema_${key}`] = value;
    }

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

  /**
   * Build schema-free models for migration generation.
   *
   * Rebuilds all entities with `schema = "public"` so Drizzle produces
   * SQL without schema qualifiers (e.g. `CREATE TABLE "users"` instead
   * of `CREATE TABLE "myschema"."users"`).
   *
   * The actual schema is applied at migration execution time via `search_path`.
   */
  public getModelsWithoutSchema(
    provider: DatabaseProvider,
  ): Record<string, unknown> {
    const maps = provider.rebuildModels("public");
    const models: Record<string, unknown> = {};

    for (const [key, value] of maps.tables.entries()) {
      if (models[key]) {
        throw new AlephaError(
          `Model name conflict: '${key}' is already defined.`,
        );
      }
      models[key] = value;
    }

    for (const [key, value] of maps.enums.entries()) {
      if (models[key]) {
        throw new AlephaError(
          `Model name conflict: '${key}' is already defined.`,
        );
      }
      models[key] = value;
    }

    for (const [key, value] of maps.sequences.entries()) {
      if (models[key]) {
        throw new AlephaError(
          `Model name conflict: '${key}' is already defined.`,
        );
      }
      models[key] = value;
    }

    return models;
  }

  /**
   * Preview schema push without executing any statements.
   *
   * Returns the SQL statements that would be executed, warnings, and
   * whether data loss would occur. Does NOT execute any SQL.
   */
  public async dryRunPush(provider: DatabaseProvider): Promise<{
    statements: string[];
    warnings: string[];
    hasDataLoss: boolean;
  }> {
    const kit = this.importDrizzleKit();
    const models = this.getModels(provider);

    if (Object.keys(models).length === 0) {
      return { statements: [], warnings: [], hasDataLoss: false };
    }

    let result: {
      statementsToExecute: string[];
      warnings: string[];
      hasDataLoss: boolean;
    };

    if (provider.dialect === "sqlite") {
      result = await kit.pushSQLiteSchema(models, provider.db as any);
    } else {
      const wrappedDb = this.wrapDbForDrizzleKit(provider.db);
      result = await kit.pushSchema(models, wrappedDb, [provider.schema]);
    }

    return {
      statements: result.statementsToExecute,
      warnings: result.warnings,
      hasDataLoss: result.hasDataLoss,
    };
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected async pushSqlite(
    kit: typeof DrizzleKit,
    models: Record<string, unknown>,
    provider: DatabaseProvider,
  ): Promise<void> {
    const { statementsToExecute, warnings, hasDataLoss } =
      await kit.pushSQLiteSchema(models, provider.db as any);
    this.reportPushRisks(warnings, hasDataLoss);
    await this.executeStatements(statementsToExecute, provider);
  }

  /**
   * Push schema changes to PostgreSQL using Drizzle Kit's pushSchema with schema filters.
   */
  protected async pushPostgres(
    kit: typeof DrizzleKit,
    models: Record<string, unknown>,
    provider: DatabaseProvider,
  ): Promise<void> {
    if (provider.schema !== "public") {
      await this.createSchemaIfNotExists(provider, provider.schema);
    }

    // Drizzle Kit's pushSchema expects execute() to return { rows: T[] }
    // (node-postgres/pg format), but postgres.js returns a Result that
    // extends Array directly — no .rows property.
    const wrappedDb = this.wrapDbForDrizzleKit(provider.db);

    const { statementsToExecute, warnings, hasDataLoss } = await kit.pushSchema(
      models,
      wrappedDb,
      [provider.schema],
    );
    this.reportPushRisks(warnings, hasDataLoss);
    await this.executeStatements(statementsToExecute, provider);
  }

  /**
   * Surface drizzle-kit's own risk assessment before running the statements.
   *
   * `push` destructured only `statementsToExecute` and ran everything, so a
   * dev-mode `synchronize()` could drop and recreate a column — wiping local
   * data — without a single line of output. drizzle-kit already computes
   * `hasDataLoss` and `warnings`; they were only being read by `dryRunPush`.
   */
  protected reportPushRisks(
    warnings: string[] | undefined,
    hasDataLoss: boolean | undefined,
  ): void {
    for (const warning of warnings ?? []) {
      this.log.warn(`Schema push warning: ${warning}`);
    }

    if (hasDataLoss) {
      this.log.warn(
        "Schema push will DESTROY DATA in this database (drizzle-kit reports data loss). This runs only outside production; review the statements below.",
      );
    }
  }

  /**
   * Execute a list of SQL statements against the provider.
   */
  protected async executeStatements(
    statements: string[],
    provider: DatabaseProvider,
  ): Promise<void> {
    if (statements.length > 0) {
      this.log.debug(`Executing ${statements.length} statements ...`, {
        statements,
      });
    }
    for (const statement of statements) {
      await provider.execute(sql.raw(statement));
    }
  }

  /**
   * Execute SQL statements, ignoring "already exists" errors.
   *
   * Used by the fallback migration path where push may have partially
   * applied changes before erroring, leaving some objects already created.
   */
  protected async executeStatementsLenient(
    statements: string[],
    provider: DatabaseProvider,
  ): Promise<void> {
    if (statements.length > 0) {
      this.log.debug(
        `Executing ${statements.length} statements (lenient) ...`,
        { statements },
      );
    }
    for (const statement of statements) {
      try {
        await provider.execute(sql.raw(statement));
      } catch (error: any) {
        const message = error?.message ?? "";
        if (message.includes("already exists")) {
          this.log.debug(`Skipped (already exists): ${statement.slice(0, 80)}`);
          continue;
        }
        throw error;
      }
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

  // -------------------------------------------------------------------------------------------------------------------

  // TODO: remove when Drizzle Kit fixes postgres.js compatibility

  /**
   * Wrap a Drizzle PgDatabase instance for compatibility with Drizzle Kit.
   *
   * Drizzle Kit's pushSchema expects execute() to return { rows: T[] }
   * (node-postgres/pg format), but postgres.js returns a Result that
   * extends Array directly — no .rows property.
   */
  protected wrapDbForDrizzleKit(db: any): any {
    return new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "execute") {
          return async (...args: any[]) => {
            const res = await target.execute(...args);
            if (Array.isArray(res) && !("rows" in res)) {
              return Object.assign(res, { rows: [...res] });
            }
            return res;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

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
