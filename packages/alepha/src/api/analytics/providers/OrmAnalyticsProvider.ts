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
  type EntityPrimitive,
  PG_REF,
  getAttr,
  Repository,
  type SQL,
  sql,
} from "alepha/orm";

import {
  type AnalyticsPruneFloorEntity,
  analyticsPruneFloorEntity,
} from "../entities/analyticsPruneFloorEntity.ts";
import { AnalyticsBuckets } from "../planner/AnalyticsBuckets.ts";
import {
  type AnalyticsColumn,
  AnalyticsFolds,
  type AnalyticsSelection,
} from "../planner/AnalyticsFolds.ts";
import { AnalyticsOrdering } from "../planner/AnalyticsOrdering.ts";
import { AnalyticsTiers } from "../planner/AnalyticsTiers.ts";
import {
  type AnalyticsTierBounds,
  AnalyticsWindow,
} from "../planner/AnalyticsWindow.ts";
import type {
  AnalyticsDataset,
  AnalyticsTierResolution,
} from "../schemas/analyticsDatasetSchema.ts";
import type {
  AnalyticsQuery,
  AnalyticsResult,
} from "../schemas/analyticsQuerySchema.ts";
import { AnalyticsEntityFactory } from "../services/AnalyticsEntityFactory.ts";
import {
  AnalyticsProvider,
  type AnalyticsRow,
  type AnalyticsTier,
} from "./AnalyticsProvider.ts";

/**
 * A drizzle table object, narrowed to the one thing this provider ever needs
 * from it besides column references: the real (possibly renamed) column
 * name, for the `excluded.<name>` half of an upsert's SET clause.
 */
type NamedColumn = { name: string };

/**
 * A value column as {@link OrmAnalyticsProvider} writes SQL for it.
 */
interface StoredColumn extends AnalyticsColumn {
  sumOnly: boolean;
  field: string;
  sql: string;
  lastAt?: { field: string; sql: string };
}

/**
 * One relational table per retention tier of a dataset: the finest buckets as
 * recorded (`_raw`), any intermediate tier (`_<resolution>`), and the
 * coarsest (`_rolled`). See `AnalyticsTiers`.
 *
 * The default on every Node and Postgres deployment, and the cold tier of the
 * Analytics Engine provider. Numbers here are **exact** - nothing samples, so
 * `estimated` is always `false`.
 *
 * Rows are stored raw in the sense that no dimension is ever dropped, but a
 * write still upserts on `(time_bucket, …dimensions)` with `count + excluded.count`.
 * That is free: batches arrive pre-folded and nothing reads finer than an hour,
 * so a page hit five hundred times in an hour is one row rather than five
 * hundred.
 *
 * ## Registration is eager, not lazy
 *
 * Call {@link register} once per dataset, **before** `alepha.start()` - the
 * same rule every `$entity`/`$repository` in the framework already lives
 * under (`Repository`'s constructor calls `DatabaseProvider.registerEntity`
 * unconditionally, with no lazy path). `entities()` is then a plain lookup;
 * a dataset that was never registered throws `AlephaError` at first use
 * rather than trying to invent a table at request time. Task 7's `$analytics()`
 * primitive is expected to call `register()` for every declared dataset at
 * construction, which - like every other primitive's `$inject`/`$repository`
 * field - runs before the app starts.
 *
 * ## Dimension and measure names are never trusted as SQL identifiers
 *
 * `dataset.dimensions`/`dataset.measures` are developer-declared, source-code
 * constants - the same trust level as an `$entity` schema, which this
 * provider inherits without extra checks. `AnalyticsQuery.where` / `groupBy`
 * / `select`, by contrast, are the shape an HTTP endpoint is most likely to
 * forward client-supplied keys into unmodified. Every name drawn from a query
 * (rather than from the dataset descriptor itself) is checked against the
 * dataset's declared dimensions/measures - via {@link assertKnownDimension}
 * / `AnalyticsFolds.selections` - before it is ever spliced into SQL text with
 * `sql.raw`. An unknown name throws `AlephaError` instead of reaching the
 * database as an attacker-chosen identifier.
 */
export class OrmAnalyticsProvider extends AnalyticsProvider {
  public readonly exact: boolean = true;

  protected readonly alepha = $inject(Alepha);
  protected readonly database = $inject(DatabaseProvider);

  /**
   * One repository per tier, finest first, per registered dataset name.
   */
  protected readonly registered = new Map<string, Repository<ZObject>[]>();

  /**
   * The shared, package-owned prune-floor table (see
   * `analyticsPruneFloorEntity`'s own doc) — one repository for every
   * dataset this provider ever registers, never one per dataset.
   *
   * Built by {@link register}, unconditionally — see
   * {@link registerPruneFloors} for why "only when the deployment needs it"
   * was the wrong condition.
   */
  protected floors?: Repository<ZObject>;

  /**
   * Derives `dataset`'s tier tables and registers every one with
   * `DatabaseProvider`, so `migrate()` (run from the database provider's own
   * `start` hook) picks them up. **Must be called before `alepha.start()`.**
   *
   * Idempotent per dataset name — a second call for an already-registered
   * dataset is a no-op, so callers do not need to track what they already
   * registered.
   *
   * Also registers the shared prune-floor table, for every deployment shape
   * and not only the one that reads it — see {@link registerPruneFloors}.
   */
  public register(dataset: AnalyticsDataset): void {
    if (this.registered.has(dataset.name)) return;

    // Before the tier tables rather than after, so a dataset is never
    // half-declared if a later step throws.
    this.registerPruneFloors();

    const built = AnalyticsEntityFactory.build(dataset);
    this.registered.set(
      dataset.name,
      built.tables.map((table) => this.buildRepository(table)),
    );
  }

  /**
   * Registers the shared prune-floor table, idempotently. Callable more
   * than once safely, and — like every other registration in this
   * package — must run **before** `alepha.start()`.
   *
   * ⚠️ **Unconditional, and that is the fix for a production outage.** This
   * used to be called only from `WaeAnalyticsProvider.register()`, on the
   * reasoning that a plain relational deployment genuinely deletes on
   * `prune()`, would never read a floor, and should not pay a migration for
   * a table it cannot use. The saving was two columns. The flaw was that it
   * made **the set of tables an app declares a function of the runtime it
   * booted under** — and migrations are generated under one runtime and
   * applied under another.
   *
   * `alepha db migrations create` runs on Node, where `index.ts` selects
   * `OrmAnalyticsProvider` and nothing ever called this. So the table never
   * entered the snapshot and never got a migration. Production runs workerd,
   * where `index.workerd.ts` selects `WaeAnalyticsProvider`, whose `query()`
   * reads the floor before *every* read — against a table the database had
   * never been told to create. Every analytics read 500'd, and nothing
   * upstream could have gone red: unit tests, typecheck and
   * `check:migrations` all run on the runtime where the table is not
   * declared.
   *
   * A relational deployment carrying an empty two-column table it never
   * reads is the correct trade. Schema does not vary by runtime.
   */
  public registerPruneFloors(): void {
    if (this.floors) return;
    this.floors = this.buildRepository(
      analyticsPruneFloorEntity as EntityPrimitive,
    );
  }

  public async record(
    dataset: AnalyticsDataset,
    rows: AnalyticsRow[],
  ): Promise<void> {
    if (rows.length === 0) return;

    const [raw] = this.entities(dataset);
    const dimensions = Object.keys(dataset.dimensions.shape).sort();
    const columns = AnalyticsFolds.columns(dataset);

    const values = rows.map((row) => {
      const record: Record<string, string | number | null> = {
        [AnalyticsEntityFactory.TIME_COLUMN]: row.hour,
      };
      for (const name of dimensions) record[name] = row[name];
      for (const column of columns) {
        const sumOnly = AnalyticsFolds.isSumOnly(dataset, column.measure);
        record[column.name] = sumOnly
          ? Number(row[column.name] ?? 0)
          : AnalyticsFolds.reading(row[column.name]);
        if (column.fold === "last") {
          const at = AnalyticsFolds.lastAt(column.measure);
          record[at] = AnalyticsFolds.reading(row[at]);
        }
      }
      return record;
    });

    await raw.upsertMany(values as never, {
      target: [AnalyticsEntityFactory.TIME_COLUMN, ...dimensions] as never,
      set: this.upsertSet(dataset, raw) as never,
    });
  }

  public async query(
    dataset: AnalyticsDataset,
    query: AnalyticsQuery,
  ): Promise<AnalyticsResult> {
    const tiers = this.entities(dataset);
    const specs = AnalyticsTiers.of(dataset);
    const groupBy = query.groupBy ?? [];
    const selections = AnalyticsFolds.selections(dataset, query.select);
    const merged = new Map<string, Record<string, string | number | null>>();
    let coarsened = false;

    for (let index = 0; index < tiers.length; index++) {
      const repository = tiers[index];
      const bounds = AnalyticsWindow.forTier(query, specs[index].resolution);
      if (
        !coarsened &&
        (await this.holdsAny(dataset, repository, query, bounds.straddling))
      ) {
        coarsened = true;
      }
      for (const row of await this.readOne(
        dataset,
        repository,
        query,
        selections,
        bounds,
      )) {
        const key = JSON.stringify(groupBy.map((name) => row[name]));
        const existing = merged.get(key);
        if (!existing) {
          merged.set(key, row);
          continue;
        }
        this.mergeSelections(dataset, selections, existing, row);
      }
    }

    // The `at` behind each `last` only served the merge above.
    const rows = [...merged.values()];
    for (const row of rows) {
      for (const selection of selections) {
        if (selection.fold === "last") delete row[this.atKey(selection)];
      }
    }

    return {
      rows: AnalyticsOrdering.apply(rows, query),
      estimated: false,
      coarsened,
    };
  }

  /**
   * Whether `repository` holds a row in one of `buckets` that passes the
   * query's dimension filters: an indexed lookup of the few buckets that
   * straddle a `from`/`to` bound, which is what `coarsened` reports.
   */
  protected async holdsAny(
    dataset: AnalyticsDataset,
    repository: Repository<ZObject>,
    query: AnalyticsQuery,
    buckets: string[],
  ): Promise<boolean> {
    if (buckets.length === 0) return false;
    const filters = this.filterConditions(dataset, repository, query);
    if (!filters) return false;
    const rows = await this.database.run(
      sql`
        SELECT 1 AS hit FROM ${repository.table}
        WHERE ${sql.join(
          [
            sql`${sql.raw(AnalyticsEntityFactory.TIME_COLUMN)} IN (${sql.join(
              buckets.map((bucket) => sql`${bucket}`),
              sql`, `,
            )})`,
            ...filters,
          ],
          sql` AND `,
        )}
        LIMIT 1
      `,
      z.object({ hit: z.coerce.number() }),
    );
    return rows.length > 0;
  }

  /**
   * Folds every row of tier `fromTier` before `before` into the next tier,
   * keyed at that tier's resolution, then deletes them.
   *
   * **One `INSERT … SELECT … ON CONFLICT` statement, whatever the backlog.**
   * The fold used to read every folded row back into JavaScript and write it
   * again through `upsertMany`: a round trip per row out and in, and on D1
   * one statement per seven rows of a ten-dimension dataset once
   * `upsertMany` learnt to respect the 100-parameter ceiling. D1 also caps
   * the statements a Worker invocation may run, and Lore's hourly sweep folds
   * four datasets in one (#Q2404). Folding in the database binds one
   * parameter, the boundary, and moves no row over the wire.
   *
   * `AS target` names the existing row for the SET clause, the one spelling
   * SQLite, D1 and Postgres all accept. The outer SELECT carries a WHERE,
   * which is what SQLite needs to read `ON CONFLICT` as the upsert rather
   * than as a join constraint. `GROUP BY` covers the whole conflict target,
   * so no row of the SELECT conflicts with another, which Postgres would
   * refuse.
   */
  public async rollup(
    dataset: AnalyticsDataset,
    fromTier: AnalyticsTier,
    before: string,
  ): Promise<void> {
    const tiers = this.entities(dataset);
    const source = tiers[fromTier];
    const target = tiers[fromTier + 1];
    if (!source || !target) return;

    const resolution = AnalyticsTiers.of(dataset)[fromTier + 1].resolution;
    const dimensions = Object.keys(dataset.dimensions.shape).sort();
    const boundary = AnalyticsBuckets.truncate(before, resolution);
    const timeColumn = AnalyticsEntityFactory.TIME_COLUMN;

    // The target key, computed from the source key; see `bucketExpression`.
    const bucketExpression = this.bucketExpression(timeColumn, resolution);
    const dimensionColumns = dimensions.map((name) =>
      this.columnName(source, name),
    );
    // Resolved through `columnName`, same as `readOne` — see its class doc.
    // Every tier is built from the one column map, so a name resolves the
    // same on either side.
    const targetColumns = [timeColumn, ...dimensionColumns];
    const valueColumns = this.storedColumns(dataset, source);
    const grouping = ["__bucket", ...dimensionColumns];
    const selectList = [
      "__bucket",
      ...dimensionColumns,
      ...valueColumns.map((column) => this.foldAggregate(column)),
    ].join(", ");
    const windows = this.lastWindows(valueColumns, [
      bucketExpression,
      ...dimensionColumns,
    ]);
    const merge = this.mergeAssignments(valueColumns);
    const insertColumns = [...targetColumns];
    for (const column of valueColumns) {
      insertColumns.push(column.sql);
      if (column.lastAt) insertColumns.push(column.lastAt.sql);
    }

    // A plain range on the bucket, never `substr(...)`, so the unique index
    // (which leads with the bucket) serves it: `'2026-08-01T23' < '2026-08-02'`
    // because a key sorts after every prefix of itself and before the next day.
    await this.database.run(
      sql`
        INSERT INTO ${target.table} AS target (${sql.raw(insertColumns.join(", "))})
        SELECT ${sql.raw(selectList)}
        FROM (
          SELECT *, ${sql.raw([`${bucketExpression} AS __bucket`, ...windows].join(", "))}
          FROM ${source.table}
          WHERE ${sql.raw(timeColumn)} < ${boundary}
        ) AS src
        WHERE true
        GROUP BY ${sql.raw(grouping.join(", "))}
        ON CONFLICT (${sql.raw(targetColumns.join(", "))})
        DO ${merge.length > 0 ? sql`UPDATE SET ${sql.join(merge, sql`, `)}` : sql`NOTHING`}
      `,
      z.object({}),
    );

    // Deleting the source rows AFTER the target rows land is what makes a
    // crashed sweep recoverable: the source rows are still there to fold.
    // Deleting first would lose them outright. A crash between the two
    // statements does fold them twice on the next sweep, since the fold adds
    // rather than replaces; D1 has no transaction to close that window.
    await this.database.run(
      sql`DELETE FROM ${source.table} WHERE ${sql.raw(timeColumn)} < ${boundary}`,
      z.object({}),
    );
  }

  /**
   * SQL computing the `resolution` key of a stored key: a prefix for a day
   * or an hour, the minute prefix for one minute, and for a 5 or 15 minute
   * step the hour prefix plus the floored minute, picked by string
   * comparison (`'07' < '10'`) so one spelling works on every dialect, with
   * no `LPAD` (absent from SQLite) or `printf` (absent from Postgres).
   */
  protected bucketExpression(
    column: string,
    resolution: AnalyticsTierResolution,
  ): string {
    if (resolution === "1d") return `substr(${column}, 1, 10)`;
    const step = AnalyticsBuckets.minutesOf(resolution);
    if (step === 60) return `substr(${column}, 1, 13)`;
    if (step === 1) return `substr(${column}, 1, 16)`;
    const cases: string[] = [];
    for (let minute = step; minute < 60; minute += step) {
      const floor = String(minute - step).padStart(2, "0");
      cases.push(
        `WHEN substr(${column}, 15, 2) < '${String(minute).padStart(2, "0")}' THEN '${floor}'`,
      );
    }
    const last = String(60 - step).padStart(2, "0");
    return `substr(${column}, 1, 14) || CASE ${cases.join(" ")} ELSE '${last}' END`;
  }

  public async prune(dataset: AnalyticsDataset, before: string): Promise<void> {
    const timeColumn = AnalyticsEntityFactory.TIME_COLUMN;
    for (const repository of this.entities(dataset)) {
      await this.database.run(
        sql`DELETE FROM ${repository.table} WHERE ${sql.raw(timeColumn)} < ${before}`,
        z.object({}),
      );
    }
  }

  /**
   * `MIN(time_bucket)` of one tier: an index lookup, since the unique index
   * leads with the bucket.
   */
  public async oldestBucket(
    dataset: AnalyticsDataset,
    tier: AnalyticsTier,
  ): Promise<string | undefined> {
    const repository = this.entities(dataset)[tier];
    if (!repository) return undefined;
    const rows = await this.database.run(
      sql`SELECT MIN(${sql.raw(AnalyticsEntityFactory.TIME_COLUMN)}) AS oldest FROM ${repository.table}`,
      z.object({ oldest: z.string().nullable() }),
    );
    return rows[0]?.oldest ?? undefined;
  }

  /**
   * Durably records `before` as `dataset`'s prune floor — the boundary below
   * which nothing should ever be served again, on any tier of any provider
   * that reaches this `OrmAnalyticsProvider` as its `cold` store.
   *
   * This provider's own `prune()`/`query()` never consult the floor — a real
   * `DELETE` already makes the data gone, full stop, so there is nothing for
   * a floor to paper over here. It exists for `WaeAnalyticsProvider`, whose
   * hot tier (Analytics Engine) has no delete API: `cold.prune()` alone
   * cannot make that data stop existing, only stop being *this provider's*
   * copy of it, so `WaeAnalyticsProvider.query()` has to clamp its own reads
   * — of both tiers — to whatever floor is recorded here. See
   * `analyticsPruneFloorEntity`'s doc for why this is a dedicated table
   * rather than a row in `dataset`'s own raw/rolled table.
   *
   * **Monotonic — never moves the floor backwards.** A floor that could
   * regress would resurrect data a caller already asked to prune: if a
   * retry or an out-of-order call passed an earlier `before` than a prior
   * call already recorded, silently accepting it would make
   * `WaeAnalyticsProvider.query()` start serving Analytics Engine's
   * un-deletable copy of a range that was correctly hidden a moment ago.
   *
   * Read-then-write, not a single atomic upsert: the boundary comparison
   * (`GREATEST`/`MAX(a, b)` as a scalar expression) is not spelled the same
   * way on Postgres and SQLite/D1, and this table sees one write per dataset
   * per sweep (hourly, from `AnalyticsRollupJobs`) — nowhere near enough
   * traffic to justify a driver-specific SQL expression for what a `findOne`
   * plus a conditional `upsertMany` already does correctly for the
   * overwhelmingly common case of one sweep at a time. A genuinely
   * concurrent pair of `prune()` calls for the same dataset could in theory
   * race between the read and the write; the failure mode is at worst
   * failing to advance the floor on one of the two calls, which the next
   * sweep (an hour later) corrects — never a regression, since the guard
   * only ever skips a write, it never lets a smaller value through.
   *
   * A silent no-op when {@link registerPruneFloors} was never called —
   * deliberately, not a defensive afterthought. Unlike {@link entities}
   * (which throws for an unregistered *dataset*, always a caller bug, every
   * dataset must be registered), an absent floor table is the permanent,
   * correct state of a plain relational deployment: it has no floor and
   * never will, because its own `prune()` genuinely deletes. Only
   * `WaeAnalyticsProvider.register()` ever calls
   * {@link registerPruneFloors}, so this only no-ops for exactly the
   * deployments that were never going to call it in the first place.
   */
  public async recordPruneFloor(
    dataset: AnalyticsDataset,
    before: string,
  ): Promise<void> {
    if (!this.floors) return;

    const boundary = AnalyticsBuckets.day(before);
    const existing = await this.readPruneFloorRow(dataset);
    if (existing && existing.floor >= boundary) {
      return;
    }

    await this.floors.upsertMany(
      [{ dataset: dataset.name, floor: boundary } as never],
      { target: ["dataset"] as never },
    );
  }

  /**
   * `dataset`'s currently recorded prune floor, or `undefined` — either
   * because `prune()` has never been called for it, or because this
   * provider never had {@link registerPruneFloors} called on it at all
   * (a plain relational deployment, which has no floor and never will —
   * see that method's own doc). Both cases mean the same thing to a
   * caller: nothing to clamp reads to.
   */
  public async pruneFloor(
    dataset: AnalyticsDataset,
  ): Promise<string | undefined> {
    return (await this.readPruneFloorRow(dataset))?.floor;
  }

  /**
   * The raw `{ dataset, floor }` row, or `undefined` — the one place the
   * loose `Repository<ZObject>` result is cast to this table's real shape,
   * so {@link recordPruneFloor}/{@link pruneFloor} both read through it
   * rather than each casting `findOne`'s result independently.
   */
  protected async readPruneFloorRow(
    dataset: AnalyticsDataset,
  ): Promise<AnalyticsPruneFloorEntity | undefined> {
    if (!this.floors) return undefined;
    const row = await this.floors.findOne({
      where: { dataset: { eq: dataset.name } } as never,
    });
    return row as never as AnalyticsPruneFloorEntity | undefined;
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * Splits `rows` by whether every foreign-key dimension still points at a
   * row that exists.
   *
   * A dimension declared with `db.ref` (Lore's `sigilId`, cascading from
   * `sigils`) is a real foreign key on both tables, so a row naming a parent
   * that is gone is refused by the database, and the whole statement with
   * it. Rows written here directly cannot hit that: the parent existed when
   * they were recorded, and deleting it cascades them away. Rows replayed
   * from a store with no delete API can, and `WaeAnalyticsProvider`'s forward
   * is exactly that: Analytics Engine keeps what a deleted sigil reported,
   * and forwarding it failed every hourly rollup on lore-production (#Q2404).
   * Dropping those rows is what the cascade would have done.
   *
   * One query per foreign key, over the distinct values only (a handful of
   * sigils, never one per row), chunked under the driver's parameter
   * ceiling.
   */
  public async withoutOrphans(
    dataset: AnalyticsDataset,
    rows: AnalyticsRow[],
  ): Promise<{
    rows: AnalyticsRow[];
    orphans: Map<string, { rows: number; values: Set<string> }>;
  }> {
    const orphans = new Map<string, { rows: number; values: Set<string> }>();
    let kept = rows;

    for (const [name, schema] of Object.entries(dataset.dimensions.shape)) {
      const ref = getAttr(schema, PG_REF);
      if (!ref || kept.length === 0) continue;

      const target = ref.ref();
      const table = this.database.table(target.entity) as never as Record<
        string,
        unknown
      >;
      const column = table[target.name];
      const values = [...new Set(kept.map((row) => row[name]))];
      const existing = new Set<unknown>();
      const size = Math.max(1, this.database.maxBoundParameters - 1);

      for (let i = 0; i < values.length; i += size) {
        const found = await this.database.run(
          sql`
            SELECT ${column} AS value
            FROM ${table}
            WHERE ${column} IN (${sql.join(
              values.slice(i, i + size).map((value) => sql`${value}`),
              sql`, `,
            )})
          `,
          z.object({ value: schema }),
        );
        for (const row of found) existing.add(row.value);
      }

      kept = kept.filter((row) => {
        if (existing.has(row[name])) return true;
        const entry = orphans.get(name) ?? { rows: 0, values: new Set() };
        entry.rows++;
        if (entry.values.size < 5) entry.values.add(String(row[name]));
        orphans.set(name, entry);
        return false;
      });
    }

    return { rows: kept, orphans };
  }

  /**
   * Looks up `dataset`'s tier repositories, finest first.
   *
   * Throws if `dataset` was never passed to {@link register}. This provider
   * never registers a table on the caller's behalf — see the class doc — so
   * a missing dataset here means an app is querying a dataset it never
   * declared, which is a bug worth failing loudly on rather than attempting
   * runtime DDL.
   */
  protected entities(dataset: AnalyticsDataset): Repository<ZObject>[] {
    const existing = this.registered.get(dataset.name);
    if (existing) return existing;

    throw new AlephaError(
      `Dataset '${dataset.name}' was never registered with OrmAnalyticsProvider. Call register(dataset) before alepha.start() — this provider cannot create tables at request time.`,
    );
  }

  /**
   * Constructs a `Repository` for a runtime-derived entity.
   *
   * `Repository.of(entity)` is the framework's documented factory for an
   * entity that only exists as a runtime value (not a class-field
   * declaration), and `{ lifetime: "transient" }` means this call itself is
   * never cached in the DI container — `register()` keeps the returned
   * instance in {@link registered} instead, so each dataset still gets
   * exactly one `Repository` per tier for the life of this provider.
   */
  protected buildRepository(entity: EntityPrimitive): Repository<ZObject> {
    return this.alepha.inject(Repository.of(entity), {
      lifetime: "transient",
    });
  }

  /**
   * The SET clause of the record upsert: every stored column merged with
   * the incoming row by its fold (see {@link mergeExpression}). Keyed by JS
   * field name, as `upsertMany` expects; `excluded.<name>` uses the column's
   * real (Drizzle-resolved) name.
   */
  protected upsertSet(
    dataset: AnalyticsDataset,
    repository: Repository<ZObject>,
  ): Record<string, unknown> {
    const table = repository.table as never as Record<string, unknown>;
    const set: Record<string, unknown> = {};
    for (const column of this.storedColumns(dataset, repository)) {
      const target = (name: string) =>
        sql`${table[this.fieldOf(column, name)]}`;
      const excluded = (name: string) => sql.raw(`excluded.${name}`);
      set[column.field] = this.mergeExpression(column, target, excluded);
      if (column.lastAt) {
        set[column.lastAt.field] = this.mergeExpression(
          column,
          target,
          excluded,
          true,
        );
      }
    }
    return set;
  }

  /**
   * One value column as stored: its fold, its JS field and SQL name, and for
   * a `last` the companion `last_at` column.
   */
  protected storedColumns(
    dataset: AnalyticsDataset,
    repository: Repository<ZObject>,
  ): StoredColumn[] {
    return AnalyticsFolds.columns(dataset).map((column) => {
      const at = AnalyticsFolds.lastAt(column.measure);
      return {
        ...column,
        sumOnly: AnalyticsFolds.isSumOnly(dataset, column.measure),
        field: column.name,
        sql: this.columnName(repository, column.name),
        lastAt:
          column.fold === "last"
            ? { field: at, sql: this.columnName(repository, at) }
            : undefined,
      };
    });
  }

  /**
   * `field` itself, or its `last_at` companion when `name` is that
   * companion's SQL name.
   */
  protected fieldOf(column: StoredColumn, name: string): string {
    return column.lastAt && name === column.lastAt.sql
      ? column.lastAt.field
      : column.field;
  }

  /**
   * How a stored value merges with an incoming one, NULL meaning "no
   * reading" on every dialect. `CASE` rather than `LEAST`/`GREATEST`
   * (Postgres) or scalar `MIN(a, b)` (SQLite, which returns NULL when either
   * side is NULL): one spelling, the same semantics everywhere.
   *
   * With `at`, the expression for a `last` column's `last_at` instead of
   * its value. Both use the same condition, and every SET expression reads
   * the row as it was before the update, so they move together.
   */
  protected mergeExpression(
    column: StoredColumn,
    target: (name: string) => SQL,
    excluded: (name: string) => SQL,
    at = false,
  ): SQL {
    const t = target(column.sql);
    const e = excluded(column.sql);
    if (column.sumOnly) return sql`${t} + ${e}`;
    if (column.fold === "sum") return sql`COALESCE(${t} + ${e}, ${t}, ${e})`;
    if (column.fold === "min" || column.fold === "max") {
      const better = column.fold === "min" ? sql.raw("<") : sql.raw(">");
      return sql`CASE WHEN ${e} IS NULL THEN ${t} WHEN ${t} IS NULL OR ${e} ${better} ${t} THEN ${e} ELSE ${t} END`;
    }
    const lastAt = column.lastAt as { sql: string };
    const tAt = target(lastAt.sql);
    const eAt = excluded(lastAt.sql);
    const wins = sql`${e} IS NOT NULL AND ${eAt} IS NOT NULL AND (${t} IS NULL OR ${tAt} IS NULL OR ${eAt} > ${tAt} OR (${eAt} = ${tAt} AND ${e} > ${t}))`;
    return at
      ? sql`CASE WHEN ${wins} THEN ${eAt} ELSE ${tAt} END`
      : sql`CASE WHEN ${wins} THEN ${e} ELSE ${t} END`;
  }

  /**
   * {@link mergeExpression} as `column = expression` assignments, for the
   * rollup's `ON CONFLICT`, where the target is the `target` alias.
   */
  protected mergeAssignments(columns: StoredColumn[]): SQL[] {
    const t = (name: string) => sql.raw(`target.${name}`);
    const e = (name: string) => sql.raw(`excluded.${name}`);
    const out: SQL[] = [];
    for (const column of columns) {
      out.push(
        sql`${sql.raw(column.sql)} = ${this.mergeExpression(column, t, e)}`,
      );
      if (column.lastAt) {
        out.push(
          sql`${sql.raw(column.lastAt.sql)} = ${this.mergeExpression(column, t, e, true)}`,
        );
      }
    }
    return out;
  }

  /**
   * The aggregate folding one column over a group of rows (the rollup's
   * `GROUP BY`), reading the windowed `last` value {@link lastWindows}
   * computed. A `last` contributes two select items: its value and its
   * `last_at`.
   */
  protected foldAggregate(column: StoredColumn): string {
    if (column.fold === "last") {
      const lastAt = column.lastAt as { sql: string };
      return `MAX(${this.windowAlias(column)}), MAX(${lastAt.sql})`;
    }
    if (column.fold === "min") return `MIN(${column.sql})`;
    if (column.fold === "max") return `MAX(${column.sql})`;
    return `SUM(${column.sql})`;
  }

  /**
   * For every `last` column, the value of the row with the greatest
   * `last_at` within the partition, ties keeping the larger value. Computed
   * in a subquery with a window function (Postgres, SQLite 3.30+ and D1 all
   * have `FIRST_VALUE` and `NULLS LAST`), then taken with `MAX()` in the
   * outer `GROUP BY`, where every row of the partition carries the same one.
   */
  protected lastWindows(
    columns: StoredColumn[],
    partition: string[],
  ): string[] {
    const over = partition.length
      ? `PARTITION BY ${partition.join(", ")} `
      : "";
    return columns
      .filter((column) => column.fold === "last")
      .map((column) => {
        const lastAt = column.lastAt as { sql: string };
        return `FIRST_VALUE(${column.sql}) OVER (${over}ORDER BY ${lastAt.sql} DESC NULLS LAST, ${column.sql} DESC NULLS LAST) AS ${this.windowAlias(column)}`;
      });
  }

  protected windowAlias(column: AnalyticsColumn & { sql: string }): string {
    return `__last_${column.sql}`;
  }

  /**
   * The hidden key carrying the `at` of a selected `last` through the
   * cross-tier merge.
   */
  protected atKey(selection: AnalyticsSelection): string {
    return `__at_${selection.key}`;
  }

  /**
   * Folds a row from another tier into `target`, selection by selection.
   */
  protected mergeSelections(
    dataset: AnalyticsDataset,
    selections: AnalyticsSelection[],
    target: Record<string, string | number | null>,
    source: Record<string, string | number | null>,
  ): void {
    for (const selection of selections) {
      const key = selection.key;
      if (selection.fold === "last") {
        const at = this.atKey(selection);
        if (
          AnalyticsFolds.laterWins(
            target[key],
            target[at],
            source[key],
            source[at],
          )
        ) {
          target[key] = source[key];
          target[at] = source[at];
        }
      } else if (AnalyticsFolds.isSumOnly(dataset, selection.measure)) {
        target[key] = Number(target[key] ?? 0) + Number(source[key] ?? 0);
      } else {
        target[key] = AnalyticsFolds.combine(
          selection.fold,
          target[key],
          source[key],
        );
      }
    }
  }

  /**
   * Resolves a dataset-declared JS field name (a dimension or a measure) to
   * its real, possibly-renamed SQL column name — the same resolution
   * {@link accumulateSet} already relies on for the `excluded.<name>` half of
   * an upsert.
   *
   * Neither `readOne` nor `rollup` splices a JS field name into `sql.raw`
   * directly: the model builder snake-cases multi-word column names
   * (`sigilId` is stored as `sigil_id`), so a raw splice of the JS name
   * produces valid SQL only by accident, when a dimension or measure happens
   * to be a single word. Every other name throws `no such column` — the
   * `where` filter every project-scoped analytics read applies
   * (`{ sigilId: { inArray: [...] } }`) hit exactly this in `readOne`, and
   * `rollup`'s `SELECT`/`GROUP BY` over the exact same dimensions hit the
   * identical bug the moment the hot-retention sweep tried to fold them.
   */
  protected columnName(repository: Repository<ZObject>, name: string): string {
    const table = repository.table as never as Record<string, NamedColumn>;
    return table[name].name;
  }

  /**
   * The query's dimension filters as SQL, or `undefined` when they can match
   * nothing (an empty `inArray`).
   */
  protected filterConditions(
    dataset: AnalyticsDataset,
    repository: Repository<ZObject>,
    query: AnalyticsQuery,
  ): SQL[] | undefined {
    const conditions: SQL[] = [];
    for (const [name, filter] of Object.entries(query.where ?? {})) {
      this.assertKnownDimension(dataset, name);
      const column = this.columnName(repository, name);

      if (
        typeof filter === "object" &&
        filter !== null &&
        "inArray" in filter
      ) {
        // Empty inArray means match nothing, never unfiltered — an `IN ()`
        // clause is invalid SQL, and even if it weren't, matching everything
        // is exactly the wrong behaviour here. Short-circuit instead.
        if (filter.inArray.length === 0) return undefined;
        conditions.push(
          sql`${sql.raw(column)} IN (${sql.join(
            filter.inArray.map((value) => sql`${value}`),
            sql`, `,
          )})`,
        );
      } else {
        conditions.push(sql`${sql.raw(column)} = ${filter}`);
      }
    }

    return conditions;
  }

  protected async readOne(
    dataset: AnalyticsDataset,
    repository: Repository<ZObject>,
    query: AnalyticsQuery,
    selections: AnalyticsSelection[],
    bounds: AnalyticsTierBounds,
  ): Promise<Array<Record<string, string | number | null>>> {
    const timeColumn = AnalyticsEntityFactory.TIME_COLUMN;

    // Plain ranges on the bucket, never a function of it, so the unique
    // index (which leads with the bucket) can serve them. Bucket keys sort
    // lexicographically and a day is a prefix of each of its hours, so
    // `>= since` keeps every hour of `since` (`'2026-08-01' <= '2026-08-01T00'`);
    // see `AnalyticsWindow` for how each form becomes this tier's range.
    const filters = this.filterConditions(dataset, repository, query);
    if (!filters) return [];
    const conditions = [
      sql`${sql.raw(timeColumn)} >= ${bounds.lower}`,
      ...filters,
    ];
    if (bounds.upper !== undefined) {
      conditions.push(sql`${sql.raw(timeColumn)} < ${bounds.upper}`);
    }

    const groupBy = query.groupBy ?? [];

    const projections = groupBy.map((name) => {
      if (name === "day") return `substr(${timeColumn}, 1, 10) AS day`;
      // A prefix, not the stored key: a sub-hour dataset stores minute keys,
      // which must not come back under `hour`.
      if (name === "hour") return `substr(${timeColumn}, 1, 13) AS hour`;
      if (name === "minute") return `${timeColumn} AS minute`;
      this.assertKnownDimension(dataset, name);
      const column = this.columnName(repository, name);
      // The decoded row is looked up by the JS field name everywhere
      // downstream (`shape`, `query()`'s grouping key, the controller's
      // `row.<dimension>` reads) — alias back to it whenever Drizzle's real
      // column name differs, so a renamed column stays invisible past here.
      // The alias is double-quoted: Postgres folds an unquoted identifier to
      // lowercase, which would turn `AS appId` into a returned column named
      // `appid` — a case mismatch the decode shape (keyed on the exact JS
      // name) would then reject as a missing field.
      return column === name ? column : `${column} AS "${name}"`;
    });

    // Each dimension decodes with its own declared type (a histogram bucket
    // dimension is a number, a path is a string) rather than a blanket
    // `z.string()` — the column comes back from the driver in whatever type
    // the dataset declared, and a mismatch throws during decode.
    const shape: Record<string, ZType> = {};
    for (const name of groupBy) {
      shape[name] =
        name === "day" || name === "hour" || name === "minute"
          ? z.string()
          : dataset.dimensions.shape[name];
    }

    const columns = new Map(
      this.storedColumns(dataset, repository).map((column) => [
        `${column.measure}:${column.fold}`,
        column,
      ]),
    );
    // A missing reading comes back NULL and must stay `null`: a bare
    // `z.coerce.number()` would turn it into `0`.
    const value = z.union([z.null(), z.coerce.number()]);
    const windowed: StoredColumn[] = [];
    for (const selection of selections) {
      const column = columns.get(
        `${selection.measure}:${selection.fold}`,
      ) as StoredColumn;
      // Quoted for the same reason the dimension alias above is: an
      // unquoted multi-word alias would fold to lowercase on Postgres and no
      // longer match `shape`'s exact-case key.
      if (column.fold === "last") {
        const lastAt = column.lastAt as { sql: string };
        windowed.push(column);
        projections.push(
          `MAX(${this.windowAlias(column)}) AS "${selection.key}"`,
          `MAX(${lastAt.sql}) AS "${this.atKey(selection)}"`,
        );
        shape[this.atKey(selection)] = value;
      } else {
        const aggregate =
          column.fold === "min" ? "MIN" : column.fold === "max" ? "MAX" : "SUM";
        projections.push(`${aggregate}(${column.sql}) AS "${selection.key}"`);
      }
      shape[selection.key] = value;
    }

    const groupExpressions = groupBy.map((name) =>
      name === "day"
        ? `substr(${timeColumn}, 1, 10)`
        : name === "hour"
          ? `substr(${timeColumn}, 1, 13)`
          : name === "minute"
            ? timeColumn
            : this.columnName(repository, name),
    );
    const grouping = groupExpressions.join(", ");

    // A `last` reads the windowed value of a subquery (see `lastWindows`),
    // partitioned exactly as the outer query groups; anything else reads
    // the table directly.
    const windows = this.lastWindows(
      [...new Map(windowed.map((column) => [column.sql, column])).values()],
      groupExpressions,
    );
    const source =
      windows.length > 0
        ? sql`(SELECT *, ${sql.raw(windows.join(", "))} FROM ${repository.table} WHERE ${sql.join(conditions, sql` AND `)}) AS src`
        : sql`${repository.table} WHERE ${sql.join(conditions, sql` AND `)}`;

    // With no `GROUP BY`, a bare `SUM(...)` over zero matching rows still
    // returns exactly one row with a NULL total in plain SQL. The interface
    // contract (pinned by `MemoryAnalyticsProvider`) is that an empty match
    // stays an empty result, so `HAVING COUNT(*) > 0` suppresses that row —
    // harmless with a `GROUP BY`, since a group only exists when at least
    // one row fed it.
    const rows = await this.database.run(
      sql`
        SELECT ${sql.raw(projections.join(", "))}
        FROM ${source}
        ${grouping ? sql.raw(`GROUP BY ${grouping}`) : sql.raw("")}
        HAVING COUNT(*) > 0
      `,
      z.object(shape),
    );

    return rows as never as Array<Record<string, string | number | null>>;
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
}
