import {
  $inject,
  Alepha,
  AlephaError,
  type ZObject,
  type ZType,
  z,
} from "alepha";
import {
  DatabaseProvider,
  DrizzleKitProvider,
  type EntityPrimitive,
  Repository,
  sql,
} from "alepha/orm";
import { AnalyticsBuckets } from "../planner/AnalyticsBuckets.ts";
import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";
import type {
  AnalyticsAggregate,
  AnalyticsQuery,
  AnalyticsResult,
} from "../schemas/analyticsQuerySchema.ts";
import { AnalyticsEntityFactory } from "../services/AnalyticsEntityFactory.ts";
import { AnalyticsProvider, type AnalyticsRow } from "./AnalyticsProvider.ts";

/**
 * A drizzle table object, narrowed to the one thing this provider ever needs
 * from it besides column references: the real (possibly renamed) column
 * name, for the `excluded.<name>` half of an upsert's SET clause.
 */
type NamedColumn = { name: string };

/**
 * Two relational tables per dataset: raw hour buckets and rolled day buckets.
 *
 * The default on every Node and Postgres deployment, and the cold tier of the
 * Analytics Engine provider. Numbers here are **exact** — nothing samples, so
 * `estimated` is always `false`.
 *
 * Rows are stored raw in the sense that no dimension is ever dropped, but a
 * write still upserts on `(time_bucket, …dimensions)` with `count + excluded.count`.
 * That is free: batches arrive pre-folded and nothing reads finer than an hour,
 * so a page hit five hundred times in an hour is one row rather than five
 * hundred.
 *
 * ## Lazy registration cannot go through the normal DI path
 *
 * A dataset is not known until something calls `record()`/`query()`/
 * `rollup()`/`prune()` with it, so its two tables are derived and registered
 * on first use rather than declared up front. That first use is necessarily
 * **after** `alepha.start()` in every real caller (and in this provider's own
 * tests) — which rules out the obvious approach of resolving a `Repository`
 * via `alepha.inject()` or `RepositoryProvider.getRepository()`: both ask the
 * container for a **singleton**, and the container refuses to mint a new
 * singleton once `started` is `true` (`ContainerLockedError` — confirmed by
 * running exactly that against a live Postgres in this file's own tests).
 * `Repository.of(entity)` + `alepha.inject(_, { lifetime: "transient" })`
 * (see {@link buildRepository}) is the one path the framework exposes for
 * "construct a service instance without touching the locked singleton
 * registry" — it still runs the constructor (which calls
 * `DatabaseProvider.registerEntity`), it just never caches the result in the
 * container, so this provider keeps its own cache instead ({@link registered}).
 *
 * Registration alone is still not enough to make the tables queryable:
 * `DatabaseProvider`'s `onStart` hook already ran `migrate()` once, and in
 * dev/test that push-synced whatever was registered *at that instant* — a
 * table registered afterwards would not exist yet, and the first real query
 * against it would fail with "relation ... does not exist". `register()`
 * therefore re-syncs after registering a never-seen-before dataset's tables,
 * via {@link synchronizeNewTables} rather than a second call to
 * `DatabaseProvider.migrate()`: in test mode `migrate()`'s sync
 * (`DrizzleKitProvider.synchronize()`) diffs against an EMPTY baseline every
 * time — there is no persisted "what did we already create" snapshot in
 * dev/test — so a second call regenerates `CREATE TABLE` for every table the
 * first call (from `onStart`) already created, starting with the framework's
 * own `alepha_sequences` bookkeeping table, and fails with "already exists"
 * (confirmed against a live Postgres in this file's own tests).
 * {@link synchronizeNewTables} generates that same always-from-scratch
 * statement list and executes it leniently instead, which is exactly the
 * fallback `DrizzleKitProvider.synchronize()` itself uses when its own push
 * sync is unavailable — that fallback is `protected`, hence not reusable
 * from here directly.
 *
 * That re-sync is a dev/test convenience only: it no-ops in production and on
 * serverless targets, matching `DrizzleKitProvider.synchronize()`'s own
 * behaviour there, since tables come from file-based migrations generated
 * ahead of time in those environments. A production deployment must
 * therefore ensure every dataset it will ever query is registered — i.e.
 * touched once via this provider — before `alepha db migrations create`
 * runs, the same requirement as any other `$entity`. Nothing in this
 * provider can invent a table in production at request time.
 *
 * ## Dimension and measure names are never trusted as SQL identifiers
 *
 * `dataset.dimensions`/`dataset.measures` are developer-declared, source-code
 * constants — the same trust level as an `$entity` schema, which this
 * provider inherits without extra checks. `AnalyticsQuery.where` / `groupBy`
 * / `select`, by contrast, are the shape an HTTP endpoint is most likely to
 * forward client-supplied keys into unmodified. Every name drawn from a query
 * (rather than from the dataset descriptor itself) is checked against the
 * dataset's declared dimensions/measures — via {@link assertKnownDimension}
 * / {@link assertKnownMeasure} — before it is ever spliced into SQL text with
 * `sql.raw`. An unknown name throws `AlephaError` instead of reaching the
 * database as an attacker-chosen identifier.
 */
export class OrmAnalyticsProvider extends AnalyticsProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly database = $inject(DatabaseProvider);
  protected readonly kit = $inject(DrizzleKitProvider);

  /**
   * One resolved `{ raw, rolled }` pair per dataset name, keyed by the
   * in-flight (or settled) registration promise rather than the result
   * itself — so two calls racing on the same never-seen-before dataset share
   * one registration + re-sync instead of each doing it independently.
   */
  protected readonly registered = new Map<
    string,
    Promise<{ raw: Repository<ZObject>; rolled: Repository<ZObject> }>
  >();

  public async record(
    dataset: AnalyticsDataset,
    rows: AnalyticsRow[],
  ): Promise<void> {
    if (rows.length === 0) return;

    const { raw } = await this.entities(dataset);
    const dimensions = Object.keys(dataset.dimensions.shape).sort();
    const measures = Object.keys(dataset.measures.shape);

    const values = rows.map((row) => {
      const record: Record<string, string | number> = {
        [AnalyticsEntityFactory.TIME_COLUMN]: row.hour,
      };
      for (const name of dimensions) record[name] = row[name];
      for (const name of measures) record[name] = Number(row[name] ?? 0);
      return record;
    });

    await raw.upsertMany(values as never, {
      target: [AnalyticsEntityFactory.TIME_COLUMN, ...dimensions] as never,
      set: this.accumulateSet(raw, measures) as never,
    });
  }

  public async query(
    dataset: AnalyticsDataset,
    query: AnalyticsQuery,
  ): Promise<AnalyticsResult> {
    const { raw, rolled } = await this.entities(dataset);
    const groupBy = query.groupBy ?? [];
    const merged = new Map<string, Record<string, string | number>>();

    for (const repository of [raw, rolled]) {
      for (const row of await this.readOne(dataset, repository, query)) {
        const key = JSON.stringify(groupBy.map((name) => row[name]));
        const existing = merged.get(key);
        if (!existing) {
          merged.set(key, row);
          continue;
        }
        for (const [measure, aggregate] of Object.entries(query.select)) {
          existing[measure] = this.mergeValue(
            Number(existing[measure] ?? 0),
            Number(row[measure] ?? 0),
            aggregate,
          );
        }
      }
    }

    let rows = [...merged.values()];

    if (query.orderBy) {
      const { key, direction } = query.orderBy;
      rows.sort((a, b) => {
        const left = a[key];
        const right = b[key];
        const comparison =
          typeof left === "number" && typeof right === "number"
            ? left - right
            : String(left).localeCompare(String(right));
        return direction === "desc" ? -comparison : comparison;
      });
    }

    if (query.limit !== undefined) rows = rows.slice(0, query.limit);

    return { rows, estimated: false };
  }

  public async rollup(
    dataset: AnalyticsDataset,
    before: string,
  ): Promise<void> {
    const { raw, rolled } = await this.entities(dataset);
    const dimensions = Object.keys(dataset.dimensions.shape).sort();
    const measures = Object.keys(dataset.measures.shape);
    const boundary = AnalyticsBuckets.day(before);
    const timeColumn = AnalyticsEntityFactory.TIME_COLUMN;

    const shape: Record<string, ZType> = { [timeColumn]: z.string() };
    for (const name of dimensions) shape[name] = dataset.dimensions.shape[name];
    for (const name of measures) shape[name] = z.coerce.number();

    const dayExpression = `substr(${timeColumn}, 1, 10)`;
    const selectList = [
      `${dayExpression} AS ${timeColumn}`,
      ...dimensions,
      ...measures.map((name) => `SUM(${name}) AS ${name}`),
    ].join(", ");
    const groupList = [dayExpression, ...dimensions].join(", ");

    const folded = await this.database.run(
      sql`
        SELECT ${sql.raw(selectList)}
        FROM ${raw.table}
        WHERE ${sql.raw(dayExpression)} < ${boundary}
        GROUP BY ${sql.raw(groupList)}
      `,
      z.object(shape),
    );

    if (folded.length > 0) {
      await rolled.upsertMany(folded as never, {
        target: [timeColumn, ...dimensions] as never,
        set: this.accumulateSet(rolled, measures) as never,
      });
    }

    // Deleting the raw rows AFTER the rolled rows land is what makes a crashed
    // sweep safe: re-running re-folds the same rows onto the same unique key,
    // which the upsert absorbs. Deleting first would lose them outright.
    await this.database.run(
      sql`DELETE FROM ${raw.table} WHERE ${sql.raw(dayExpression)} < ${boundary}`,
      z.object({}),
    );
  }

  public async prune(dataset: AnalyticsDataset, before: string): Promise<void> {
    const { raw, rolled } = await this.entities(dataset);
    const boundary = AnalyticsBuckets.day(before);
    const dayExpression = `substr(${AnalyticsEntityFactory.TIME_COLUMN}, 1, 10)`;

    for (const repository of [raw, rolled]) {
      await this.database.run(
        sql`DELETE FROM ${repository.table} WHERE ${sql.raw(dayExpression)} < ${boundary}`,
        z.object({}),
      );
    }
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Resolves (and, on first use of a dataset, registers) the raw and rolled
   * repositories for `dataset`. See the class doc for why this has to go
   * through {@link buildRepository} + {@link synchronizeNewTables} rather
   * than the normal `$repository()`/`alepha.inject()`/`migrate()` path.
   */
  protected entities(
    dataset: AnalyticsDataset,
  ): Promise<{ raw: Repository<ZObject>; rolled: Repository<ZObject> }> {
    const existing = this.registered.get(dataset.name);
    if (existing) return existing;

    const promise = this.register(dataset);
    this.registered.set(dataset.name, promise);
    return promise;
  }

  protected async register(
    dataset: AnalyticsDataset,
  ): Promise<{ raw: Repository<ZObject>; rolled: Repository<ZObject> }> {
    const built = AnalyticsEntityFactory.build(dataset);

    // Constructing a repository is what registers its entity with
    // `DatabaseProvider` (see `Repository`'s constructor) — building both
    // here means the raw and rolled tables are always registered together,
    // regardless of which public method saw this dataset first.
    const raw = this.buildRepository(built.raw);
    const rolled = this.buildRepository(built.rolled);

    await this.synchronizeNewTables();

    return { raw, rolled };
  }

  /**
   * Constructs a `Repository` for a runtime-derived entity without asking
   * the (possibly already-locked) DI container for a new singleton. See the
   * class doc's "Lazy registration" section for why `alepha.inject(Entity)`
   * or `RepositoryProvider.getRepository()` cannot be used here.
   */
  protected buildRepository(entity: EntityPrimitive): Repository<ZObject> {
    return this.alepha.inject(Repository.of(entity), {
      lifetime: "transient",
    });
  }

  /**
   * Creates whatever tables were just registered, leaving everything else
   * untouched. See the class doc for why `DatabaseProvider.migrate()` itself
   * cannot be called a second time.
   *
   * `generateMigration()` diffs the currently-registered models against an
   * empty baseline, so its statement list always includes every table ever
   * registered, not only the new one. Executing each statement individually
   * and swallowing only "already exists" failures — mirroring
   * `DrizzleKitProvider`'s own (`protected`, otherwise unreachable from here)
   * `executeStatementsLenient` — means the already-existing tables are
   * no-ops and the new ones are created.
   *
   * A no-op in production and on serverless targets: those environments get
   * their tables from file-based migrations generated ahead of time, and
   * must never have arbitrary DDL executed against them from a request path.
   */
  protected async synchronizeNewTables(): Promise<void> {
    if (this.alepha.isProduction() || this.alepha.isServerless()) return;

    const { statements } = await this.kit.generateMigration(this.database);
    for (const statement of statements) {
      try {
        await this.database.execute(sql.raw(statement));
      } catch (error) {
        if (!this.mentionsAlreadyExists(error)) throw error;
      }
    }
  }

  /**
   * Whether an error, or anything in its `cause` chain, mentions "already
   * exists" — mirrors `DrizzleKitProvider.errorMentions`. drizzle rc.4 wraps
   * driver errors in `DrizzleQueryError`, whose own message is
   * `Failed query: <sql>`; the driver's actual text ("relation ... already
   * exists") is one level down, in `cause`.
   */
  protected mentionsAlreadyExists(error: unknown): boolean {
    const seen = new Set<unknown>();
    let current: unknown = error;

    while (current && typeof current === "object" && !seen.has(current)) {
      seen.add(current);
      const withMessage = current as { message?: unknown; cause?: unknown };
      if (String(withMessage.message ?? "").includes("already exists")) {
        return true;
      }
      current = withMessage.cause;
    }

    return false;
  }

  /**
   * `measure = measure + excluded.measure` for every measure, so a batch
   * upsert adds what the batch actually carried rather than a fixed
   * increment. `excluded.<name>` uses the column's real (Drizzle-resolved)
   * name, not the JS field key, mirroring `createOrmAnalyticsStore`'s
   * `bucketIncrements()`.
   */
  protected accumulateSet(
    repository: Repository<ZObject>,
    measures: string[],
  ): Record<string, unknown> {
    const table = repository.table as never as Record<string, NamedColumn>;
    const set: Record<string, unknown> = {};
    for (const name of measures) {
      const column = table[name];
      set[name] =
        sql`${(table as never as Record<string, unknown>)[name]} + excluded.${sql.raw(column.name)}`;
    }
    return set;
  }

  protected async readOne(
    dataset: AnalyticsDataset,
    repository: Repository<ZObject>,
    query: AnalyticsQuery,
  ): Promise<Array<Record<string, string | number>>> {
    const timeColumn = AnalyticsEntityFactory.TIME_COLUMN;

    const conditions = [
      sql`substr(${sql.raw(timeColumn)}, 1, 10) >= ${query.since}`,
    ];

    for (const [name, filter] of Object.entries(query.where ?? {})) {
      this.assertKnownDimension(dataset, name);

      if (
        typeof filter === "object" &&
        filter !== null &&
        "inArray" in filter
      ) {
        // Empty inArray means match nothing, never unfiltered — an `IN ()`
        // clause is invalid SQL, and even if it weren't, matching everything
        // is exactly the wrong behaviour here. Short-circuit instead.
        if (filter.inArray.length === 0) return [];
        conditions.push(
          sql`${sql.raw(name)} IN (${sql.join(
            filter.inArray.map((value) => sql`${value}`),
            sql`, `,
          )})`,
        );
      } else {
        conditions.push(sql`${sql.raw(name)} = ${filter}`);
      }
    }

    const groupBy = query.groupBy ?? [];

    const projections = groupBy.map((name) => {
      if (name === "day") return `substr(${timeColumn}, 1, 10) AS day`;
      if (name === "hour") return `${timeColumn} AS hour`;
      this.assertKnownDimension(dataset, name);
      return name;
    });

    // Each dimension decodes with its own declared type (a histogram bucket
    // dimension is a number, a path is a string) rather than a blanket
    // `z.string()` — the column comes back from the driver in whatever type
    // the dataset declared, and a mismatch throws during decode.
    const shape: Record<string, ZType> = {};
    for (const name of groupBy) {
      shape[name] =
        name === "day" || name === "hour"
          ? z.string()
          : dataset.dimensions.shape[name];
    }

    for (const [measure, aggregate] of Object.entries(query.select)) {
      this.assertKnownMeasure(dataset, measure);
      const expression = aggregate === "count" ? "COUNT(*)" : `SUM(${measure})`;
      projections.push(`${expression} AS ${measure}`);
      shape[measure] = z.coerce.number();
    }

    const grouping = groupBy
      .map((name) =>
        name === "day"
          ? `substr(${timeColumn}, 1, 10)`
          : name === "hour"
            ? timeColumn
            : name,
      )
      .join(", ");

    // With no `GROUP BY`, a bare `SUM(...)` over zero matching rows still
    // returns exactly one row with a NULL total in plain SQL. The interface
    // contract (pinned by `MemoryAnalyticsProvider`) is that an empty match
    // stays an empty result, so `HAVING COUNT(*) > 0` suppresses that row —
    // harmless with a `GROUP BY`, since a group only exists when at least
    // one row fed it.
    const rows = await this.database.run(
      sql`
        SELECT ${sql.raw(projections.join(", "))}
        FROM ${repository.table}
        WHERE ${sql.join(conditions, sql` AND `)}
        ${grouping ? sql.raw(`GROUP BY ${grouping}`) : sql.raw("")}
        HAVING COUNT(*) > 0
      `,
      z.object(shape),
    );

    return rows as never as Array<Record<string, string | number>>;
  }

  /**
   * Refuses a query name (from `where`/`groupBy`) that is not one of the
   * dataset's own declared dimensions. See the class doc: these names come
   * from `AnalyticsQuery`, which is far more likely to carry client-supplied
   * input than `AnalyticsDataset`, and are about to be spliced into SQL text
   * as a raw identifier.
   */
  protected assertKnownDimension(
    dataset: AnalyticsDataset,
    name: string,
  ): void {
    if (!Object.hasOwn(dataset.dimensions.shape, name)) {
      throw new AlephaError(
        `Query on dataset '${dataset.name}' references '${name}', which is not a declared dimension. Declared dimensions: ${Object.keys(dataset.dimensions.shape).join(", ") || "(none)"}.`,
      );
    }
  }

  /**
   * Same guard as {@link assertKnownDimension}, for `select` keys against
   * the dataset's declared measures.
   */
  protected assertKnownMeasure(dataset: AnalyticsDataset, name: string): void {
    if (!Object.hasOwn(dataset.measures.shape, name)) {
      throw new AlephaError(
        `Query on dataset '${dataset.name}' references '${name}', which is not a declared measure. Declared measures: ${Object.keys(dataset.measures.shape).join(", ") || "(none)"}.`,
      );
    }
  }

  protected mergeValue(
    left: number,
    right: number,
    aggregate: AnalyticsAggregate,
  ): number {
    if (aggregate === "sum" || aggregate === "count") return left + right;
    throw new AlephaError(`Received an unknown aggregate '${aggregate}'.`);
  }
}
