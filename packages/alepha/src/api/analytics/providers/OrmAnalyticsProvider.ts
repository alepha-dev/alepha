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
  Repository,
  sql,
} from "alepha/orm";
import {
  type AnalyticsPruneFloorEntity,
  analyticsPruneFloorEntity,
} from "../entities/analyticsPruneFloorEntity.ts";
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
 * / {@link assertKnownMeasure} - before it is ever spliced into SQL text with
 * `sql.raw`. An unknown name throws `AlephaError` instead of reaching the
 * database as an attacker-chosen identifier.
 */
export class OrmAnalyticsProvider extends AnalyticsProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly database = $inject(DatabaseProvider);

  /**
   * One `{ raw, rolled }` repository pair per registered dataset name.
   */
  protected readonly registered = new Map<
    string,
    { raw: Repository<ZObject>; rolled: Repository<ZObject> }
  >();

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
   * Derives `dataset`'s raw and rolled tables and registers both with
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

    // Before the raw/rolled pair rather than after, so a dataset is never
    // half-declared if a later step throws.
    this.registerPruneFloors();

    const built = AnalyticsEntityFactory.build(dataset);
    const raw = this.buildRepository(built.raw);
    const rolled = this.buildRepository(built.rolled);

    this.registered.set(dataset.name, { raw, rolled });
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

    const { raw } = this.entities(dataset);
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
    const { raw, rolled } = this.entities(dataset);
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
    const { raw, rolled } = this.entities(dataset);
    const dimensions = Object.keys(dataset.dimensions.shape).sort();
    const measures = Object.keys(dataset.measures.shape);
    const boundary = AnalyticsBuckets.day(before);
    const timeColumn = AnalyticsEntityFactory.TIME_COLUMN;

    const shape: Record<string, ZType> = { [timeColumn]: z.string() };
    for (const name of dimensions) shape[name] = dataset.dimensions.shape[name];
    for (const name of measures) shape[name] = z.coerce.number();

    const dayExpression = `substr(${timeColumn}, 1, 10)`;
    // Resolved through `columnName`, same as `readOne` — see its class doc.
    // `folded`'s decoded rows are fed straight into `rolled.upsertMany`,
    // keyed by these JS names (via `shape`), so every projection here has to
    // come back aliased to the JS name whenever the real column differs, not
    // merely be valid SQL.
    const selectList = [
      `${dayExpression} AS ${timeColumn}`,
      ...dimensions.map((name) => {
        const column = this.columnName(raw, name);
        return column === name ? column : `${column} AS "${name}"`;
      }),
      ...measures.map((name) => {
        const column = this.columnName(raw, name);
        return `SUM(${column}) AS "${name}"`;
      }),
    ].join(", ");
    const groupList = [
      dayExpression,
      ...dimensions.map((name) => this.columnName(raw, name)),
    ].join(", ");

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
    const { raw, rolled } = this.entities(dataset);
    const boundary = AnalyticsBuckets.day(before);
    const dayExpression = `substr(${AnalyticsEntityFactory.TIME_COLUMN}, 1, 10)`;

    for (const repository of [raw, rolled]) {
      await this.database.run(
        sql`DELETE FROM ${repository.table} WHERE ${sql.raw(dayExpression)} < ${boundary}`,
        z.object({}),
      );
    }
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
   * Looks up the raw and rolled repositories for `dataset`.
   *
   * Throws if `dataset` was never passed to {@link register}. This provider
   * never registers a table on the caller's behalf — see the class doc — so
   * a missing dataset here means an app is querying a dataset it never
   * declared, which is a bug worth failing loudly on rather than attempting
   * runtime DDL.
   */
  protected entities(dataset: AnalyticsDataset): {
    raw: Repository<ZObject>;
    rolled: Repository<ZObject>;
  } {
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
      const column = this.columnName(repository, name);

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
          sql`${sql.raw(column)} IN (${sql.join(
            filter.inArray.map((value) => sql`${value}`),
            sql`, `,
          )})`,
        );
      } else {
        conditions.push(sql`${sql.raw(column)} = ${filter}`);
      }
    }

    const groupBy = query.groupBy ?? [];

    const projections = groupBy.map((name) => {
      if (name === "day") return `substr(${timeColumn}, 1, 10) AS day`;
      if (name === "hour") return `${timeColumn} AS hour`;
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
        name === "day" || name === "hour"
          ? z.string()
          : dataset.dimensions.shape[name];
    }

    for (const [measure, aggregate] of Object.entries(query.select)) {
      this.assertKnownMeasure(dataset, measure);
      this.assertKnownAggregate(aggregate);
      const column = this.columnName(repository, measure);
      // Quoted for the same reason the dimension alias above is: an
      // unquoted multi-word alias would fold to lowercase on Postgres and no
      // longer match `shape`'s exact-case key.
      projections.push(`SUM(${column}) AS "${measure}"`);
      shape[measure] = z.coerce.number();
    }

    const grouping = groupBy
      .map((name) =>
        name === "day"
          ? `substr(${timeColumn}, 1, 10)`
          : name === "hour"
            ? timeColumn
            : this.columnName(repository, name),
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
    this.assertKnownAggregate(aggregate);
    return left + right;
  }

  /**
   * Defence in depth against a query built from unchecked request input
   * (`select[key] = req.query.aggregate`) — `AnalyticsQuery` types `select`'s
   * values as {@link AnalyticsAggregate}, but the type system cannot see that
   * far, and `"sum"` is the only value this provider knows how to fold or
   * project.
   */
  protected assertKnownAggregate(
    aggregate: AnalyticsAggregate,
  ): asserts aggregate is "sum" {
    if (aggregate !== "sum") {
      throw new AlephaError(`Received an unknown aggregate '${aggregate}'.`);
    }
  }
}
