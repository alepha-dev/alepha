import { AlephaError } from "alepha";
import { AnalyticsBuckets } from "../planner/AnalyticsBuckets.ts";
import { AnalyticsSlotMap } from "../planner/AnalyticsSlotMap.ts";
import type { AnalyticsDataset } from "../schemas/analyticsDatasetSchema.ts";
import type {
  AnalyticsAggregate,
  AnalyticsQuery,
  AnalyticsResult,
} from "../schemas/analyticsQuerySchema.ts";
import { AnalyticsEngineSql } from "../services/AnalyticsEngineSql.ts";
import { AnalyticsProvider, type AnalyticsRow } from "./AnalyticsProvider.ts";

/**
 * The write half of a Workers Analytics Engine dataset binding.
 *
 * Declared here rather than imported from `@cloudflare/workers-types` so this
 * module compiles and tests anywhere — the whole surface is one method, and
 * depending on the Workers type package to describe it would make a provider
 * that needs no workerd API only buildable under workerd.
 */
export interface AnalyticsEngineDataset {
  writeDataPoint(point: {
    indexes?: string[];
    blobs?: Array<string | null>;
    doubles?: number[];
  }): void;
}

export interface WaeAnalyticsProviderOptions {
  dataset: AnalyticsEngineDataset;
  datasetName: string;
  sql: AnalyticsEngineSql;
  /**
   * Where rolled data lives. **Not optional** — see the class docstring.
   */
  cold: AnalyticsProvider;
}

/**
 * Hot rows on Workers Analytics Engine, rolled rows in a durable store.
 *
 * A plain class, not a DI service: it takes its dependencies as a
 * constructor options object rather than `$inject`/`$env` fields, on
 * purpose. Its `dataset` binding and `sql` credentials only exist inside a
 * deployed Worker, `vitest` cannot bind a real dataset, and `wrangler dev`
 * treats `writeDataPoint` as a no-op — so nothing about this class can be
 * exercised generically the way `OrmAnalyticsProvider` is. An app's own
 * Cloudflare bootstrap is expected to read the real binding and credentials
 * (the same way `R2FileStorageProvider` reads `cloudflare.env` at `start`)
 * and construct this class explicitly; `index.workerd.ts` exports it for
 * that purpose but does not auto-wire it — see that module's docstring.
 *
 * ## Every number read back is an estimate
 *
 * Analytics Engine samples, and `_sample_interval` — how many real events each
 * stored row stands for — varies per row, so a constant multiplier is wrong.
 * Counts come back as `sum(double * _sample_interval)`, never `count()`, and
 * the result carries `estimated: true` so a UI cannot present them as
 * measurements by accident.
 *
 * ## The cold tier cannot be Analytics Engine
 *
 * Writing aggregates back as new data points would give them a fresh retention
 * clock, re-sample already-sampled data, and require a discriminator to keep
 * rolled rows from being counted alongside the raw ones they summarise. So a
 * Cloudflare deployment needs a relational store for anything older than the
 * hot window — the same compromise unique visitors already forced on
 * `WaeAnalyticsStore` in `@alepha/sigil`.
 *
 * `rollup`/`prune` therefore delegate to a composed `cold` provider — but
 * `record()` never writes to `cold`, only to Analytics Engine. Nothing in
 * this class moves a row from hot to cold; that migration (read the folded
 * aggregate off Analytics Engine via `sql.query`, write it into `cold` as an
 * *exact* row even though it started as an *estimate*) is a real, currently
 * unaddressed gap, deliberately left for a dedicated scheduled job rather
 * than invented here without a spec for how an estimate becomes a permanent
 * exact number. Delegating still buys two things today: a `cold` composed
 * from several datasets gets driven on the same schedule as everything else,
 * and both calls stay safe and idempotent no matter when the migration job
 * lands.
 *
 * ## Writes are free of round-trips
 *
 * `writeDataPoint()` returns nothing and is not awaited; the runtime writes in
 * the background. The sequential round-trip cost that dominates a remote
 * database disappears on this path entirely.
 */
export class WaeAnalyticsProvider extends AnalyticsProvider {
  /**
   * Analytics Engine keeps roughly three months.
   */
  public static readonly MAX_HOT_DAYS = 90;

  protected readonly options: WaeAnalyticsProviderOptions;

  constructor(options: WaeAnalyticsProviderOptions) {
    super();
    this.options = options;
  }

  /**
   * The hot tier has nothing to declare — Analytics Engine has no schema to
   * create ahead of time, the same as `MemoryAnalyticsProvider`. Two things
   * still have to happen here rather than at first write:
   *
   * - `retention.hot` is checked now, via {@link assertRetention}. Analytics
   *   Engine silently discards data past ~90 days regardless of what a
   *   dataset declares, so a longer window has to fail loud at declaration
   *   time, not once a report quietly comes up short months later.
   * - `cold` is registered, so its own tables exist before `alepha.start()`
   *   — the same eager-registration rule `OrmAnalyticsProvider` follows,
   *   inherited here because `cold` typically *is* an `OrmAnalyticsProvider`.
   */
  public register(dataset: AnalyticsDataset): void {
    this.assertRetention(dataset);
    this.options.cold.register(dataset);
  }

  /**
   * Refuses a dataset whose declared hot window outlives what Analytics
   * Engine actually keeps.
   *
   * Public (not just called from {@link register}) so a caller building a
   * dataset descriptor by hand can validate it before wiring anything up.
   */
  public assertRetention(dataset: AnalyticsDataset): void {
    const hot = dataset.retention?.hot;
    if (!hot) return;
    const days = AnalyticsBuckets.parseWindow(hot) / (24 * 60 * 60 * 1000);
    if (days > WaeAnalyticsProvider.MAX_HOT_DAYS) {
      throw new AlephaError(
        `Dataset '${dataset.name}' asks for a ${days}-day hot window, but Analytics Engine keeps roughly 90 days. Shorten 'retention.hot' or the window will silently be shorter than declared.`,
      );
    }
  }

  public async record(
    dataset: AnalyticsDataset,
    rows: AnalyticsRow[],
  ): Promise<void> {
    const map = AnalyticsSlotMap.forDataset(dataset);

    for (const row of rows) {
      const blobs: Array<string | null> = [];
      blobs[AnalyticsSlotMap.KIND_SLOT - 1] = dataset.name;
      blobs[AnalyticsSlotMap.HOUR_SLOT - 1] = row.hour;
      for (const name of map.dimensionNames) {
        blobs[map.blobSlot(name) - 1] = String(row[name] ?? "");
      }

      const doubles: number[] = [];
      for (const name of map.measureNames) {
        doubles[map.doubleSlot(name) - 1] = Number(row[name] ?? 0);
      }

      this.options.dataset.writeDataPoint({
        indexes: [String(row[dataset.index] ?? "")],
        blobs: blobs.map((value) => value ?? null),
        doubles: doubles.map((value) => value ?? 0),
      });
    }
  }

  public async query(
    dataset: AnalyticsDataset,
    query: AnalyticsQuery,
  ): Promise<AnalyticsResult> {
    const map = AnalyticsSlotMap.forDataset(dataset);
    const conditions = [
      `blob${AnalyticsSlotMap.KIND_SLOT} = ${AnalyticsEngineSql.quote(dataset.name)}`,
      `blob${AnalyticsSlotMap.HOUR_SLOT} >= ${AnalyticsEngineSql.quote(query.since)}`,
    ];

    for (const [name, filter] of Object.entries(query.where ?? {})) {
      // `map.blobSlot` throws `AlephaError` for a name that is not one of
      // `dataset`'s declared dimensions — the same guard
      // `OrmAnalyticsProvider` gives an explicit name to
      // (`assertKnownDimension`). `query.where`'s keys are far more likely to
      // carry client-supplied input than `dataset` itself, and this call has
      // to run before the name is spliced into SQL text as a raw column
      // reference, not after.
      const slot = `blob${map.blobSlot(name)}`;

      if (
        typeof filter === "object" &&
        filter !== null &&
        "inArray" in filter
      ) {
        // An empty list means "match nothing". Emitting `IN ()` would be a
        // syntax error, and omitting the clause would silently widen the
        // query to every row — the failure that matters.
        if (filter.inArray.length === 0) {
          return { rows: [], estimated: true };
        }
        conditions.push(
          `${slot} IN (${AnalyticsEngineSql.quoteList(filter.inArray)})`,
        );
      } else {
        conditions.push(
          `${slot} = ${AnalyticsEngineSql.quote(filter as string | number)}`,
        );
      }
    }

    const groupBy = query.groupBy ?? [];
    const projections: string[] = [];
    const grouping: string[] = [];
    for (const name of groupBy) {
      const expression =
        name === "day"
          ? `substring(blob${AnalyticsSlotMap.HOUR_SLOT}, 1, 10)`
          : name === "hour"
            ? `blob${AnalyticsSlotMap.HOUR_SLOT}`
            : `blob${map.blobSlot(name)}`;
      projections.push(`${expression} AS ${name}`);
      grouping.push(expression);
    }

    for (const [measure, aggregate] of Object.entries(query.select)) {
      // Same guard as above, against `query.select`'s keys — thrown by
      // `map.doubleSlot` for a measure the dataset never declared.
      const slot = `double${map.doubleSlot(measure)}`;
      projections.push(
        `${this.aggregateExpression(aggregate, slot)} AS ${measure}`,
      );
    }

    projections.push("max(_sample_interval) AS _si");

    const rows = await this.options.sql.query(`
      SELECT ${projections.join(", ")}
      FROM ${this.options.datasetName}
      WHERE ${conditions.join(" AND ")}
      ${grouping.length ? `GROUP BY ${grouping.join(", ")}` : ""}
      HAVING COUNT(*) > 0
    `);

    let sampleInterval = 1;
    const out: Array<Record<string, string | number>> = rows.map((row) => {
      sampleInterval = Math.max(
        sampleInterval,
        AnalyticsEngineSql.num(row, "_si"),
      );
      const record: Record<string, string | number> = {};
      for (const name of groupBy) {
        record[name] = AnalyticsEngineSql.str(row, name);
      }
      for (const measure of Object.keys(query.select)) {
        record[measure] = AnalyticsEngineSql.num(row, measure);
      }
      return record;
    });

    // Sorted and limited client-side, never in the SQL text. `orderBy.key` is
    // caller-supplied — most plausibly an HTTP endpoint's query params — and
    // splicing it into an `ORDER BY` clause would let it name an arbitrary
    // expression rather than one of the columns this query actually
    // projected. Every sibling provider already sorts here, for the same
    // reason its own cross-tier merge has to happen in JS.
    if (query.orderBy) {
      const { key, direction } = query.orderBy;
      out.sort((a, b) => {
        const left = a[key];
        const right = b[key];
        const comparison =
          typeof left === "number" && typeof right === "number"
            ? left - right
            : String(left).localeCompare(String(right));
        return direction === "desc" ? -comparison : comparison;
      });
    }

    const limited = query.limit !== undefined ? out.slice(0, query.limit) : out;

    return { rows: limited, estimated: true, sampleInterval };
  }

  /**
   * Delegated in full to the durable cold provider. See the class doc for
   * what this does and does not achieve.
   */
  public rollup(dataset: AnalyticsDataset, before: string): Promise<void> {
    return this.options.cold.rollup(dataset, before);
  }

  public prune(dataset: AnalyticsDataset, before: string): Promise<void> {
    return this.options.cold.prune(dataset, before);
  }

  /**
   * Never `count()`, never a bare `sum()`: the sample interval varies per
   * row, so the correction has to live inside the aggregate expression
   * itself. The `AlephaError` branch is defence in depth — `AnalyticsQuery`
   * types `select`'s values as {@link AnalyticsAggregate}, but a query built
   * from unchecked request input (`select[key] = req.query.aggregate`)
   * could still hand this a string the type system never sees.
   */
  protected aggregateExpression(
    aggregate: AnalyticsAggregate,
    slot: string,
  ): string {
    if (aggregate === "count") return "sum(_sample_interval)";
    if (aggregate === "sum") return `sum(${slot} * _sample_interval)`;
    throw new AlephaError(`Received an unknown aggregate '${aggregate}'.`);
  }
}
