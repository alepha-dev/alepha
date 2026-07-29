import { createRequire } from "node:module";
import { $inject, Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import type * as DrizzleKitPostgres from "drizzle-kit/payload/postgres";
import type * as DrizzleKitSqlite from "drizzle-kit/payload/sqlite";
import { sql } from "drizzle-orm";
import type { DatabaseProvider } from "./drivers/DatabaseProvider.ts";

/**
 * drizzle-kit v1 splits its programmatic API per dialect. Both modules
 * export the same names, but their `pushSchema` arities differ — postgres
 * takes an extra `EntitiesFilterConfig` — so call sites still narrow.
 */
export type DrizzleKitPayload =
  | typeof DrizzleKitPostgres
  | typeof DrizzleKitSqlite;

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
   * - SQLite: uses `pushSchema` (requires sync driver — node:sqlite shim or bun-sqlite)
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
    const kit = this.importDrizzleKit(this.payloadDialect(provider));
    const models = this.getModels(provider);

    if (Object.keys(models).length === 0) {
      this.log.info(`No models to synchronize for '${provider.name}'`);
      return;
    }

    try {
      await this.push(kit, models, provider);
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
   * Used by tests (schema validation) and CLI (`alepha db migrations create`).
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
    const kit = this.importDrizzleKit(this.payloadDialect(provider));
    const models = options?.withoutSchema
      ? this.getModelsWithoutSchema(provider)
      : this.getModels(provider);

    if (Object.keys(models).length > 0) {
      const prev = prevSnapshot
        ? this.ensureV7Snapshot(kit, prevSnapshot)
        : await kit.generateDrizzleJson({});
      const curr = await kit.generateDrizzleJson(models);
      return {
        models,
        statements: await kit.generateMigration(prev as any, curr as any),
        snapshot: curr,
      };
    }

    return {
      models,
      statements: [],
      snapshot: {},
    };
  }

  /**
   * Upgrade a pre-rc.4 snapshot (drizzle-kit v6 shape) to the v7 shape
   * `generateMigration` requires.
   *
   * v7 snapshots carry a `ddl` array; v6 ones (persisted by every
   * `migrations/*\/meta/*.json` generated before this upgrade) don't have
   * one at all — `generateMigration` dereferences it unconditionally and
   * throws `prev.ddl is not iterable` on anything older. Detected on the
   * snapshot's own shape (absence of `ddl`) rather than trusting a
   * `version` field, since the missing array is precisely what crashes.
   *
   * Both dialect payloads export `up` for this conversion, so this needs no
   * dialect branch — only a shape normalization, since postgres's `up`
   * wraps the result as `{ snapshot, hints }` while sqlite's returns the
   * snapshot directly.
   */
  protected ensureV7Snapshot(kit: DrizzleKitPayload, snapshot: any): any {
    if (Array.isArray(snapshot?.ddl)) {
      return snapshot;
    }

    const upgraded = (kit as any).up(snapshot);
    return upgraded && typeof upgraded === "object" && "snapshot" in upgraded
      ? upgraded.snapshot
      : upgraded;
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
    const kit = this.importDrizzleKit(this.payloadDialect(provider));
    const models = this.getModels(provider);

    if (Object.keys(models).length === 0) {
      return { statements: [], warnings: [], hasDataLoss: false };
    }

    const result = await this.callPushSchema(kit, models, provider);

    // v1 replaced the `hasDataLoss` boolean with structured `hints`. Every
    // hint drizzle raises is a destructive-change confirmation ("about to
    // delete non-empty table", "about to drop column(s)"), so their presence
    // is the data-loss signal. Alepha's public shape is preserved.
    return {
      statements: result.sqlStatements,
      warnings: result.hints.map((h) => h.hint),
      hasDataLoss: result.hints.length > 0,
    };
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Invoke the dialect's `pushSchema`.
   *
   * Postgres takes an `EntitiesFilterConfig` object where v0 took a plain
   * `string[]` of schemas; all four of its keys are required even when
   * undefined. SQLite has no such parameter.
   */
  protected async callPushSchema(
    kit: DrizzleKitPayload,
    models: Record<string, unknown>,
    provider: DatabaseProvider,
  ): Promise<{
    sqlStatements: string[];
    hints: Array<{ hint: string; statement?: string }>;
    apply: () => Promise<void>;
  }> {
    if (provider.dialect === "sqlite") {
      const sqlite = kit as typeof DrizzleKitSqlite;
      return await sqlite.pushSchema(models, provider.db as any);
    }

    const postgres = kit as typeof DrizzleKitPostgres;
    const wrappedDb = this.wrapDbForDrizzleKit(provider.db);
    return await postgres.pushSchema(models, wrappedDb as any, {
      schemas: [provider.schema],
      tables: undefined,
      entities: undefined,
      extensions: undefined,
    });
  }

  /**
   * Push schema changes to the database using drizzle-kit's introspection.
   */
  protected async push(
    kit: DrizzleKitPayload,
    models: Record<string, unknown>,
    provider: DatabaseProvider,
  ): Promise<void> {
    if (provider.dialect !== "sqlite" && provider.schema !== "public") {
      await this.createSchemaIfNotExists(provider, provider.schema);
    }

    const result = await this.callPushSchema(kit, models, provider);
    this.reportPushRisks(
      result.hints.map((h) => h.hint),
      result.hints.length > 0,
    );
    await this.executeStatements(result.sqlStatements, provider);
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
        if (this.errorMentions(error, "already exists")) {
          this.log.debug(`Skipped (already exists): ${statement.slice(0, 80)}`);
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * Report whether an error, or anything in its `cause` chain, mentions a
   * fragment of driver text.
   *
   * drizzle rc.4 wraps driver errors in `DrizzleQueryError`, whose own message
   * is `Failed query: <sql>` — the driver's actual text ("table X already
   * exists") moved down into `cause`. Matching only the top-level message
   * therefore stopped working silently at the upgrade, which turned a
   * recoverable "already exists" into a hard startup failure against any
   * pre-existing development database, and made `yarn v` pass on a clean tree
   * then fail on every subsequent run.
   *
   * The `seen` set guards against a self-referential cause chain, which would
   * otherwise hang the process rather than surface the original error.
   */
  protected errorMentions(error: unknown, fragment: string): boolean {
    const seen = new Set<unknown>();
    let current: any = error;

    while (current && typeof current === "object" && !seen.has(current)) {
      seen.add(current);
      if (String(current.message ?? "").includes(fragment)) {
        return true;
      }
      current = current.cause;
    }

    return false;
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
   * `DatabaseProvider.dialect` is "sqlite" | "postgresql"; drizzle-kit's
   * payload split uses the same two names. Kept as a method so a future
   * dialect (mysql) has one place to land.
   */
  protected payloadDialect(
    provider: DatabaseProvider,
  ): "postgresql" | "sqlite" {
    return provider.dialect === "sqlite" ? "sqlite" : "postgresql";
  }

  /**
   * Load the official Drizzle Kit programmatic API for a dialect.
   *
   * v1 removed the single `drizzle-kit/api` entrypoint. `api-*` now holds
   * only `startStudioServer`; the real surface is `payload/<dialect>`.
   */
  public importDrizzleKit(dialect: "postgresql" | "sqlite"): DrizzleKitPayload {
    const specifier =
      dialect === "sqlite"
        ? "drizzle-kit/payload/sqlite"
        : "drizzle-kit/payload/postgres";

    try {
      return createRequire(import.meta.url)(specifier);
    } catch (_) {
      throw new AlephaError(
        "Drizzle Kit is not installed. Please install it with `npm install -D drizzle-kit`.",
      );
    }
  }
}
