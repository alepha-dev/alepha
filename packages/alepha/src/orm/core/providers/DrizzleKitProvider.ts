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

    // Required for pushSchema with Postgres and POSTGRES_SCHEMA
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
      result = await this.muteSpinner(() =>
        kit.pushSQLiteSchema(models, provider.db as any),
      );
    } else {
      const wrappedDb = this.wrapDbForDrizzleKit(provider.db);
      result = await this.muteSpinner(() =>
        kit.pushSchema(models, wrappedDb, [provider.schema]),
      );
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
    const result = await this.muteSpinner(() =>
      kit.pushSQLiteSchema(models, provider.db as any),
    );

    await this.runPushResult(result, provider);
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

    // Drizzle Kit's pushSchema internally does:
    //   const res = await drizzleInstance.execute(sql.raw(query));
    //   return res.rows;
    //
    // This assumes node-postgres (pg) format where execute() returns { rows: [...] }.
    // But postgres.js (used by Alepha) returns a Result that extends Array — no .rows property.
    // We wrap the db instance so execute() returns { rows: [...] } as expected.
    const wrappedDb = this.wrapDbForDrizzleKit(provider.db);

    const result = await this.muteSpinner(() =>
      kit.pushSchema(models, wrappedDb, [provider.schema]),
    );

    await this.runPushResult(result, provider);
  }

  /**
   * Run the statements returned by Drizzle Kit's pushSchema, with safety filters and logging.
   */
  protected async runPushResult(
    result: {
      statementsToExecute: string[];
      warnings: string[];
      hasDataLoss: boolean;
    },
    provider: DatabaseProvider,
  ) {
    // Filter out destructive schema/table drops — never auto-apply those in dev.
    const safe = (result.statementsToExecute as string[]).filter((s) => {
      const upper = s.trimStart().toUpperCase();
      if (upper.startsWith("DROP SCHEMA") || upper.startsWith("DROP TABLE")) {
        this.log.warn("Skipping destructive statement", { statement: s });
        return false;
      }
      return true;
    });

    if (result.hasDataLoss) {
      this.log.warn("Push would cause data loss", {
        warnings: result.warnings,
        statements: result.statementsToExecute,
      });
    }

    if (safe.length > 0) {
      this.log.debug(`Pushing ${safe.length} statements ...`, {
        statements: safe,
      });
      for (const statement of safe) {
        await provider.execute(sql.raw(statement));
      }
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
      const upper = statement.trimStart().toUpperCase();
      // Schema lifecycle is managed by createSchemaIfNotExists / generateTestSchema.
      if (
        upper.startsWith("DROP SCHEMA") ||
        upper.startsWith("CREATE SCHEMA")
      ) {
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

  // -------------------------------------------------------------------------------------------------------------------

  // TODO: remove both hacks when Drizzle Kit is updated !

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
   * Suppress Drizzle Kit's spinner output during a callback.
   *
   * Drizzle Kit uses hanji's renderWithTask with a setInterval-based spinner.
   * If the wrapped task throws, the interval is never cleared and leaks
   * spinner frames to stdout. We keep the filter active until the next
   * tick after the promise settles to catch any straggling writes.
   */
  protected async muteSpinner<T>(fn: () => Promise<T>): Promise<T> {
    const originalWrite = process.stdout.write;
    const filter = (chunk: any, ...args: any[]) => {
      const str =
        typeof chunk === "string" ? chunk : (chunk?.toString?.() ?? "");
      if (str.includes("Pulling schema from database")) {
        return true;
      }
      if (str.includes("\x1B[1A")) {
        return true;
      }
      return (originalWrite as any).call(process.stdout, chunk, ...args);
    };
    process.stdout.write = filter as any;
    try {
      return await fn();
    } finally {
      // Delay restore to catch orphaned setInterval spinner writes
      // that fire after the promise rejects but before cleanup.
      await new Promise((r) => setTimeout(r, 200));
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
