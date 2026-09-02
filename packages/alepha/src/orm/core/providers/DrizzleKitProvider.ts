import * as nodeModule from "node:module";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { $inject, Alepha, AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import type * as DrizzleKitPostgres from "drizzle-kit/payload/postgres";
import type * as DrizzleKitSqlite from "drizzle-kit/payload/sqlite";
import { getColumns, getTableName, sql, type Table } from "drizzle-orm";

import type { DatabaseProvider } from "./drivers/DatabaseProvider.ts";

/**
 * drizzle-kit v1 splits its programmatic API per dialect. Both modules
 * export the same names, but their `pushSchema` arities differ — postgres
 * takes an extra `EntitiesFilterConfig` — so call sites still narrow.
 */
export type DrizzleKitPayload =
  | typeof DrizzleKitPostgres
  | typeof DrizzleKitSqlite;

/**
 * What a development `synchronize()` did, so a caller (or a spec) can tell a
 * database that matches the entities from one the sync could only partly
 * repair. The boot log says the same thing; this is the same fact as a value.
 */
export interface SchemaSyncResult {
  /**
   * `false` when the push failed and the fallback, which can only create
   * tables, met tables that already existed and left them as they were.
   * Entity changes on those tables have not reached the database.
   */
  complete: boolean;

  /**
   * Fallback statements skipped because their table already existed.
   */
  skipped: number;

  /**
   * Columns (`table.column`) and tables the entities no longer declared,
   * dropped so that a push drizzle-kit could not resolve on its own would go
   * through. Empty when the push needed no help.
   */
  dropped: string[];

  /**
   * The error the push failed with, when the fallback was taken.
   */
  pushError?: unknown;
}

/**
 * The shape both dialects' `pushSchema` resolve to.
 */
export interface PushSchemaResult {
  sqlStatements: string[];
  hints: Array<{ hint: string; statement?: string }>;
  apply: () => Promise<void>;
}

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
   * A rename drizzle-kit cannot decide on its own is resolved as a drop and
   * a create (see {@link push}). When the push fails outright, the fallback
   * creates the tables that are missing and the result says, as does the
   * log, whether existing tables were left behind.
   *
   * Does nothing in production mode — use file-based migrations instead.
   */
  public async synchronize(
    provider: DatabaseProvider,
  ): Promise<SchemaSyncResult> {
    const result: SchemaSyncResult = {
      complete: true,
      skipped: 0,
      dropped: [],
    };

    if (this.alepha.isProduction()) {
      this.log.warn("Synchronization skipped in production mode.");
      return result;
    }

    if (this.alepha.isTest()) {
      const { statements } = await this.generateMigration(provider);
      await this.executeStatements(
        statements.map((s) =>
          s.replace(/^CREATE SCHEMA /i, "CREATE SCHEMA IF NOT EXISTS "),
        ),
        provider,
      );
      return result;
    }

    const now = this.dateTime.nowMillis();
    const kit = this.importDrizzleKit(this.payloadDialect(provider));
    const models = this.getModels(provider);

    if (Object.keys(models).length === 0) {
      this.log.info(`No models to synchronize for '${provider.name}'`);
      return result;
    }

    try {
      result.dropped = await this.push(kit, models, provider);
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
      const { applied, skipped } = await this.executeStatementsLenient(
        statements,
        provider,
      );
      result.pushError = error;
      result.skipped = skipped;
      if (skipped > 0) {
        result.complete = false;
      }
      this.reportFallbackOutcome(provider.name, applied, skipped, error);
    }

    const elapsed = this.dateTime.nowMillis() - now;
    if (result.complete) {
      this.log.info(`Synchronization of '${provider.name}' OK [${elapsed}ms]`);
    } else {
      this.log.warn(
        `Synchronization of '${provider.name}' INCOMPLETE [${elapsed}ms]`,
      );
    }

    return result;
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

    let result: PushSchemaResult;
    try {
      result = await this.callPushSchema(kit, models, provider);
    } catch (error) {
      // A preview must not take the drops `push` takes to get past this, so
      // it can only say what it ran into, in place of drizzle-kit's
      // "Internal error".
      if (this.isRenameResolutionError(error)) {
        throw new AlephaError(
          "drizzle-kit cannot compute this push outside a terminal: a table has both an added and a removed column (or one table was added while another was removed) and it wants to ask whether that is a rename. `alepha dev` resolves it by dropping what the entities no longer declare; to preview or apply the change here, create a migration with `alepha db migrations create` instead.",
          { cause: error },
        );
      }
      throw error;
    }

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
  ): Promise<PushSchemaResult> {
    if (provider.dialect === "sqlite") {
      const sqlite = kit as typeof DrizzleKitSqlite;
      return await sqlite.pushSchema(
        models,
        this.sqliteDbForDrizzleKit(provider) as any,
      );
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
   * Adapt a provider to the `SQLiteDB` shape drizzle-kit's sqlite payload
   * introspects through: a single `query(sql): Promise<Row[]>`.
   *
   * `provider.db` is a drizzle *ORM* instance, which has `all`/`get`/`run`
   * and no `query` at all, so `pushSchema` threw `db.query is not a function`
   * on the very first introspection call, for every sqlite provider, every
   * time. The throw was caught by {@link synchronize}'s fallback, which
   * diffs against an EMPTY snapshot and can therefore only ever emit
   * `CREATE TABLE`; on a database that already had those tables the lenient
   * executor skipped all of them and the run logged "Synchronization OK"
   * having applied nothing. A column added to an entity simply never
   * reached any existing local dev database, silently.
   *
   * Only `query` is needed: `pushSchema` uses it for introspection and for
   * its data-loss `suggestions`, and Alepha runs `sqlStatements` itself
   * rather than calling the returned `apply()` (the only user of `batch`).
   */
  protected sqliteDbForDrizzleKit(provider: DatabaseProvider): {
    query: (query: string) => Promise<Record<string, unknown>[]>;
  } {
    return {
      query: (query: string) => provider.execute(sql.raw(query)),
    };
  }

  /**
   * Push schema changes to the database using drizzle-kit's introspection.
   *
   * Returns the columns and tables it had to drop first, see below.
   *
   * ### The rename drizzle-kit cannot decide
   *
   * `pushSchema` diffs the database against the entities and, for each
   * table with both an added and a removed column (or for a table added
   * while another was removed), asks whether that is a rename. The asking
   * is wired to its CLI's prompt, which needs a terminal, and outside one
   * the programmatic call throws `resolver(column) was called without a
   * HintsHandler` instead. There is no parameter to answer through: the
   * `HintsHandler` it wants is built inside `pushSchema` itself. So one
   * renamed column in a week of entity changes used to send the whole sync
   * to the fallback, which can only create tables, and the boot log said
   * "OK".
   *
   * A development push means "make the database look like the entities",
   * and a rename it cannot see is a drop and a create. So on exactly that
   * error the columns and tables the entities no longer declare are dropped
   * here, each one named in a warning, and the push runs again on a diff
   * that only adds. Development data in a dropped column is lost, as it
   * would have been had drizzle-kit's own prompt been answered "create".
   */
  protected async push(
    kit: DrizzleKitPayload,
    models: Record<string, unknown>,
    provider: DatabaseProvider,
  ): Promise<string[]> {
    if (provider.dialect !== "sqlite" && provider.schema !== "public") {
      await this.createSchemaIfNotExists(provider, provider.schema);
    }

    let dropped: string[] = [];
    let result: PushSchemaResult;
    try {
      result = await this.callPushSchema(kit, models, provider);
    } catch (error) {
      if (!this.isRenameResolutionError(error)) {
        throw error;
      }
      this.log.warn(
        "Schema push needs a rename decision drizzle-kit cannot ask for outside a terminal. Columns and tables the entities no longer declare are dropped so the push can go through; development data in them is lost.",
        { error },
      );
      dropped = await this.dropUndeclared(provider);
      result = await this.callPushSchema(kit, models, provider);
    }

    this.reportPushRisks(
      result.hints.map((h) => h.hint),
      result.hints.length > 0,
    );
    await this.executeStatements(result.sqlStatements, provider);
    return dropped;
  }

  /**
   * drizzle-kit's prompt-bound resolver refusing to run without a terminal.
   * The text is its own, so the match is on the one fragment no other error
   * carries.
   */
  protected isRenameResolutionError(error: unknown): boolean {
    return this.errorMentions(error, "without a HintsHandler");
  }

  /**
   * Say what the fallback could and could not do.
   *
   * The fallback diffs against an EMPTY snapshot, so it can only ever
   * CREATE. Every statement it skips is a table that already existed and
   * was left exactly as it was: a column added to that entity never reached
   * the database, and the app only finds out when a query names it.
   *
   * `skipped > 0`, not `skipped > 0 && applied === 0`: a database that is
   * only PARTLY behind (one new table, three tables missing a column)
   * applied the one CREATE and skipped the rest, and the narrower condition
   * let it log "Synchronization OK". Anything skipped means the fallback
   * could not say whether those tables match their entities, and that is
   * worth a warning every time.
   */
  protected reportFallbackOutcome(
    providerName: string,
    applied: number,
    skipped: number,
    error: unknown,
  ): void {
    if (skipped === 0) {
      return;
    }
    this.log.warn(
      `Schema of '${providerName}' could NOT be fully synchronized: the push failed (${this.describePushError(error)}) and the fallback only knows how to create tables; ${applied} created, ${skipped} already existed and were left as they are. Entity changes to existing tables have NOT been applied: run your migrations, or delete the development database (node_modules/.alepha/sqlite.db for the default sqlite setup) and start again.`,
      { error },
    );
  }

  /**
   * One line for the boot log: drizzle-kit's internal error reads as a bug
   * in drizzle-kit, and the person reading the log needs the situation, not
   * the symptom.
   */
  protected describePushError(error: unknown): string {
    if (this.isRenameResolutionError(error)) {
      return "drizzle-kit needed a rename decision it cannot ask for outside a terminal, and a column in the way could not be dropped";
    }
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Drop every column and table the database has and the entities do not,
   * so the diff drizzle-kit computes next holds no removal it could mistake
   * for a rename. Only called once the push has already refused to decide
   * one; the normal path leaves the drops to drizzle-kit, which reports
   * them through its hints.
   *
   * Returns what went, as `table` and `table.column`. A drop the database
   * refuses (sqlite will not drop a column an index or a key still uses,
   * postgres will not drop a table an extension owns) is logged and left
   * for the retried push to fail on.
   */
  protected async dropUndeclared(
    provider: DatabaseProvider,
  ): Promise<string[]> {
    const dropped: string[] = [];
    const declared = this.declaredColumns(provider);
    const existing = await this.existingColumns(provider);

    for (const [table, columns] of existing) {
      const wanted = declared.get(table);
      const qualified = this.qualifiedTableName(provider, table);

      if (!wanted) {
        try {
          await provider.execute(sql.raw(`DROP TABLE ${qualified}`));
          this.log.warn(`Dropped table '${table}': no entity declares it`);
          dropped.push(table);
        } catch (error) {
          this.log.warn(`Could not drop undeclared table '${table}'`, {
            error,
          });
        }
        continue;
      }

      for (const column of columns) {
        if (wanted.has(column)) {
          continue;
        }
        try {
          await provider.execute(
            sql.raw(
              `ALTER TABLE ${qualified} DROP COLUMN ${this.quoteIdentifier(column)}`,
            ),
          );
          this.log.warn(
            `Dropped column '${table}.${column}': the entity no longer declares it`,
          );
          dropped.push(`${table}.${column}`);
        } catch (error) {
          this.log.warn(
            `Could not drop undeclared column '${table}.${column}', the push may still need a rename decision`,
            { error },
          );
        }
      }
    }

    return dropped;
  }

  /**
   * Table name to the set of column names the entities declare, as they are
   * spelled in SQL.
   */
  protected declaredColumns(
    provider: DatabaseProvider,
  ): Map<string, Set<string>> {
    const declared = new Map<string, Set<string>>();
    for (const value of provider.tables.values()) {
      const table = value as Table;
      const columns = Object.values(getColumns(table)).map(
        (column) => column.name,
      );
      declared.set(getTableName(table), new Set(columns));
    }
    return declared;
  }

  /**
   * Table name to its column names as the database has them, for the base
   * tables of the provider's schema. The migration journals are not tables
   * the entities declare and are not for dropping.
   */
  protected async existingColumns(
    provider: DatabaseProvider,
  ): Promise<Map<string, string[]>> {
    const existing = new Map<string, string[]>();
    const journals = new Set([
      provider.migrationsTable,
      "__drizzle_migrations",
    ]);

    if (provider.dialect === "sqlite") {
      const tables = await provider.execute(
        sql.raw(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        ),
      );
      for (const row of tables) {
        const name = String(row.name);
        if (journals.has(name)) {
          continue;
        }
        const info = await provider.execute(
          sql.raw(`PRAGMA table_info(${this.quoteIdentifier(name)})`),
        );
        existing.set(
          name,
          info.map((column) => String(column.name)),
        );
      }
      return existing;
    }

    const rows = await provider.execute(
      sql`SELECT c.table_name AS "table", c.column_name AS "column"
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          WHERE c.table_schema = ${provider.schema} AND t.table_type = 'BASE TABLE'
          ORDER BY c.table_name, c.ordinal_position`,
    );
    for (const row of rows) {
      const name = String(row.table);
      if (journals.has(name)) {
        continue;
      }
      const columns = existing.get(name) ?? [];
      columns.push(String(row.column));
      existing.set(name, columns);
    }
    return existing;
  }

  protected qualifiedTableName(
    provider: DatabaseProvider,
    table: string,
  ): string {
    const name = this.quoteIdentifier(table);
    return provider.dialect === "sqlite"
      ? name
      : `${this.quoteIdentifier(provider.schema)}.${name}`;
  }

  /**
   * Double quotes, which both dialects read as an identifier.
   */
  protected quoteIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
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
  ): Promise<{ applied: number; skipped: number }> {
    if (statements.length > 0) {
      this.log.debug(
        `Executing ${statements.length} statements (lenient) ...`,
        { statements },
      );
    }
    let applied = 0;
    let skipped = 0;
    for (const statement of statements) {
      try {
        await provider.execute(sql.raw(statement));
        applied++;
      } catch (error: any) {
        if (this.errorMentions(error, "already exists")) {
          this.log.debug(`Skipped (already exists): ${statement.slice(0, 80)}`);
          skipped++;
          continue;
        }
        throw error;
      }
    }
    return { applied, skipped };
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

    const require = createRequire(import.meta.url);
    this.ensureDrizzleOrmResolvable(require);

    try {
      return require(specifier);
    } catch (cause) {
      // Keep the cause. Reporting every failure as "not installed" sent us
      // hunting for a missing package that was sitting right there; the real
      // message was `Cannot find module 'drizzle-orm/_relations'`.
      throw new AlephaError(
        `Failed to load Drizzle Kit ('${specifier}'). It ships with alepha, so this is usually a broken install: try reinstalling dependencies.`,
        { cause },
      );
    }
  }

  /**
   * Whether {@link ensureDrizzleOrmResolvable} has already run.
   *
   * `registerHooks` is process-global, so it is installed at most once.
   */
  protected drizzleOrmHookInstalled = false;

  /**
   * Let drizzle-kit find `drizzle-orm` when the installer put them at
   * different depths.
   *
   * drizzle-kit imports `drizzle-orm` at runtime without declaring it as a
   * dependency or a peer, so it only resolves when both land in the same
   * `node_modules/`. Under yarn and pnpm `drizzle-orm` is nested inside
   * `node_modules/alepha/` (it carries a dozen optional peers, so they give
   * it a virtual instance) while drizzle-kit sits at the top level, and every
   * in-process call here died on `Cannot find module 'drizzle-orm/_relations'`.
   *
   * The hook only fires once normal resolution has already failed, so a
   * healthy install behaves exactly as before. Where it does fire, it
   * resolves against alepha's own copy, which is the version drizzle-kit was
   * shipped alongside.
   *
   * The spawned-binary path needs the same treatment for its own child
   * process: see `DbCommand.prepareDrizzleOrmResolution`.
   */
  protected ensureDrizzleOrmResolvable(require: NodeJS.Require): void {
    if (this.drizzleOrmHookInstalled) {
      return;
    }
    this.drizzleOrmHookInstalled = true;

    // Read off the namespace rather than imported by name: Bun's `node:module`
    // has no `registerHooks`, and a named import of a missing export is a load
    // -time SyntaxError there, so the whole ORM module would fail to evaluate.
    //
    // Node 22.15+ / 23.5+. Older runtimes, and Bun, keep the previous
    // behaviour, which works wherever the installer hoisted both packages
    // together.
    const registerHooks = (
      nodeModule as { registerHooks?: typeof nodeModule.registerHooks }
    ).registerHooks;
    if (typeof registerHooks !== "function") {
      return;
    }

    let ownRequire: NodeJS.Require;
    try {
      ownRequire = createRequire(
        pathToFileURL(require.resolve("drizzle-orm")).href,
      );
    } catch {
      // alepha cannot see it either, so there is nothing to point at.
      return;
    }

    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (
          specifier !== "drizzle-orm" &&
          !specifier.startsWith("drizzle-orm/")
        ) {
          return nextResolve(specifier, context);
        }
        try {
          return nextResolve(specifier, context);
        } catch (error) {
          // Resolved here rather than by re-delegating with a different
          // `parentURL`: CJS `require` derives the parent from the requiring
          // module and ignores the one in the context, so delegation fixes
          // the ESM half only.
          try {
            return {
              url: pathToFileURL(ownRequire.resolve(specifier)).href,
              shortCircuit: true,
            };
          } catch {
            throw error;
          }
        }
      },
    });
  }
}
