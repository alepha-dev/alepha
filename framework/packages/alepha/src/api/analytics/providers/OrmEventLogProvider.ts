import {
  $inject,
  Alepha,
  AlephaError,
  type ZObject,
  type ZType,
  z,
} from "alepha";
import {
  $entity,
  DatabaseProvider,
  type EntityPrimitive,
  Repository,
} from "alepha/orm";
import { type SQL, sql } from "drizzle-orm";

import {
  type EventLogSelection,
  EventLogPlan,
} from "../planner/EventLogPlan.ts";
import type {
  AnalyticsEventLog,
  EventLogGrain,
  EventLogQuery,
  EventLogResult,
  EventLogStoredRow,
} from "../schemas/eventLogSchema.ts";
import { EventLogProvider } from "./EventLogProvider.ts";

type Value = string | number | boolean | null;

/**
 * Event logs on a relational database: SQLite, Cloudflare D1 and Postgres.
 *
 * One table per log, `analytics_<name>_events`, holding the declared
 * columns and `event_at` (millis), indexed on `(index column, event_at)`,
 * the shape of nearly every read: one app, one window. No primary key and
 * no unique index: two identical events are two rows.
 *
 * **D1's 100 bound parameters.** Two places could exceed it, and neither
 * binds more than one value per list on SQLite:
 *
 * - `append` sends the whole batch as one JSON array and inserts from
 *   `json_each`, so a batch is one statement binding one value, whatever
 *   its size. On Postgres (65,535 parameters) it is a plain multi-row insert,
 *   chunked by `Repository.createMany`.
 * - an `inArray` filter on SQLite reads `IN (SELECT value FROM json_each(?))`,
 *   one bound value for the whole set; on Postgres it is a plain `IN` list.
 *
 * **Names.** Every column, grain and selection a query names is validated by
 * `EventLogPlan.selections` against the declaration before it reaches SQL
 * text; values are always bound.
 */
export class OrmEventLogProvider extends EventLogProvider {
  public static readonly TIME_COLUMN = "event_at";

  protected readonly alepha = $inject(Alepha);
  protected readonly database = $inject(DatabaseProvider);

  protected readonly registered = new Map<string, Repository<ZObject>>();

  public static tableName(log: AnalyticsEventLog): string {
    return `analytics_${log.name}_events`;
  }

  /**
   * Builds the log's entity and registers it, so `migrate()` creates it.
   * Must run before `alepha.start()`; idempotent per log name.
   */
  public register(log: AnalyticsEventLog): void {
    if (this.registered.has(log.name)) return;
    const entity = $entity({
      name: OrmEventLogProvider.tableName(log),
      schema: z.object({
        ...log.schema.shape,
        [OrmEventLogProvider.TIME_COLUMN]: z.int64(),
      }),
      indexes: [
        { columns: [log.index, OrmEventLogProvider.TIME_COLUMN] },
        // The hourly prune deletes the oldest rows first, across every
        // index value: without this, each run would sort the whole log.
        { columns: [OrmEventLogProvider.TIME_COLUMN] },
      ],
    }) as EntityPrimitive;
    // `Repository.of` registers the entity with the database provider, as
    // a declared `$repository` would, which puts it in the migration.
    this.registered.set(
      log.name,
      this.alepha.inject(Repository.of(entity), { lifetime: "transient" }),
    );
  }

  public async append(
    log: AnalyticsEventLog,
    rows: EventLogStoredRow[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const repository = this.repository(log);
    const names = Object.keys(log.schema.shape);

    if (this.database.dialect === "postgresql") {
      await repository.createMany(
        rows.map((row) => {
          const out: Record<string, unknown> = {
            [OrmEventLogProvider.TIME_COLUMN]: row.at,
          };
          for (const name of names) out[name] = row[name] ?? null;
          return out;
        }),
      );
      return;
    }

    const columns = [...names, OrmEventLogProvider.TIME_COLUMN];
    const payload = JSON.stringify(
      rows.map((row) => [...names.map((name) => row[name] ?? null), row.at]),
    );
    const targets = columns
      .map((name) => this.columnName(repository, name))
      .join(", ");
    const values = columns
      .map((_, index) => `json_extract(value, '$[${index}]')`)
      .join(", ");
    await this.database.execute(
      sql`INSERT INTO ${repository.table} (${sql.raw(targets)}) SELECT ${sql.raw(values)} FROM json_each(${payload})`,
    );
  }

  public async query(
    log: AnalyticsEventLog,
    query: EventLogQuery,
  ): Promise<EventLogResult> {
    const selections = EventLogPlan.selections(log, query);
    const repository = this.repository(log);
    const time = OrmEventLogProvider.TIME_COLUMN;
    const { lower, upper } = EventLogPlan.bounds(query);

    const conditions: SQL[] = [sql`${sql.raw(time)} >= ${lower}`];
    if (upper !== undefined) conditions.push(sql`${sql.raw(time)} < ${upper}`);
    for (const [name, filter] of Object.entries(query.where ?? {})) {
      const column = sql.raw(this.columnName(repository, name));
      if (typeof filter === "object" && filter !== null) {
        if (filter.inArray.length === 0) {
          return { rows: [], estimated: false };
        }
        conditions.push(
          this.database.dialect === "postgresql"
            ? sql`${column} IN (${sql.join(
                filter.inArray.map((value) => sql`${value}`),
                sql`, `,
              )})`
            : sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(filter.inArray)}))`,
        );
      } else {
        conditions.push(sql`${column} = ${this.bindable(filter)}`);
      }
    }

    const groupBy = query.groupBy ?? [];
    const groupExpressions = groupBy.map((name) =>
      EventLogPlan.isGrain(name)
        ? this.grainExpression(name)
        : this.columnName(repository, name),
    );
    const projections = groupBy.map(
      (name, index) => `${groupExpressions[index]} AS "${name}"`,
    );
    const shape: Record<string, ZType> = {};
    for (const name of groupBy) shape[name] = z.any();
    for (const selection of selections) {
      projections.push(
        `${this.aggregate(repository, selection)} AS "${selection.key}"`,
      );
      shape[selection.key] = z.union([z.null(), z.coerce.number()]);
    }

    let statement = sql`SELECT ${sql.raw(projections.join(", "))} FROM ${repository.table} WHERE ${sql.join(conditions, sql` AND `)}`;
    if (groupExpressions.length > 0) {
      statement = sql`${statement} GROUP BY ${sql.raw(groupExpressions.join(", "))}`;
    }
    // With no GROUP BY, an aggregate over zero rows still returns one row;
    // an empty match must stay an empty result, as in memory.
    statement = sql`${statement} HAVING COUNT(*) > 0`;
    if (query.orderBy) {
      const key = `"${query.orderBy.key}"`;
      const direction = query.orderBy.direction === "desc" ? "DESC" : "ASC";
      statement = sql`${statement} ORDER BY ${sql.raw(`${key} ${direction} NULLS LAST`)}`;
    }
    if (query.limit !== undefined) {
      statement = sql`${statement} LIMIT ${sql.raw(String(query.limit))}`;
    }

    const rows = (await this.database.run(statement, z.object(shape))) as Array<
      Record<string, Value>
    >;
    for (const row of rows) {
      for (const name of groupBy) {
        if (EventLogPlan.isGrain(name)) continue;
        row[name] = this.decode(log.schema.shape[name] as ZType, row[name]);
      }
    }
    return { rows, estimated: false };
  }

  /**
   * One `DELETE` of the oldest `limit` expired rows, picked by the row's
   * physical id (`rowid` on SQLite, `ctid` on Postgres) since the table has
   * no key, through the `(index, event_at)` index's time order.
   */
  public async prune(
    log: AnalyticsEventLog,
    before: number,
    limit: number,
  ): Promise<number> {
    const repository = this.repository(log);
    const time = sql.raw(OrmEventLogProvider.TIME_COLUMN);
    const id = sql.raw(
      this.database.dialect === "postgresql" ? "ctid" : "rowid",
    );
    const count = sql.raw(String(Math.max(1, Math.floor(limit))));
    const deleted = await this.database.run(
      sql`DELETE FROM ${repository.table} WHERE ${id} IN (SELECT ${id} FROM ${repository.table} WHERE ${time} < ${before} ORDER BY ${time} LIMIT ${count}) RETURNING 1 AS gone`,
      z.object({ gone: z.coerce.number() }),
    );
    return deleted.length;
  }

  protected repository(log: AnalyticsEventLog): Repository<ZObject> {
    const repository = this.registered.get(log.name);
    if (!repository) {
      throw new AlephaError(
        `Event log '${log.name}' was never registered with the relational provider; declare it with $eventLog before the app starts.`,
      );
    }
    return repository;
  }

  /**
   * The database name of a column: drizzle's, which snake_cases a camelCase
   * key.
   */
  protected columnName(repository: Repository<ZObject>, name: string): string {
    const table = repository.table as unknown as Record<
      string,
      { name: string }
    >;
    return table[name].name;
  }

  /**
   * The UTC bucket key of `event_at` at `grain`, in the dialect's own date
   * functions, matching `EventLogPlan.bucket` exactly.
   */
  protected grainExpression(grain: EventLogGrain): string {
    const time = OrmEventLogProvider.TIME_COLUMN;
    if (this.database.dialect === "postgresql") {
      const instant = `(to_timestamp(${time} / 1000.0) AT TIME ZONE 'UTC')`;
      if (grain === "hour") return `to_char(${instant}, 'YYYY-MM-DD"T"HH24')`;
      if (grain === "day") return `to_char(${instant}, 'YYYY-MM-DD')`;
      if (grain === "month") return `to_char(${instant}, 'YYYY-MM')`;
      return `to_char(date_trunc('week', ${instant}), 'YYYY-MM-DD')`;
    }
    const seconds = `${time} / 1000, 'unixepoch'`;
    if (grain === "hour") return `strftime('%Y-%m-%dT%H', ${seconds})`;
    if (grain === "day") return `strftime('%Y-%m-%d', ${seconds})`;
    if (grain === "month") return `strftime('%Y-%m', ${seconds})`;
    // 'weekday 0' moves forward to the Sunday ending the ISO week (or stays
    // on it), and six days back is that week's Monday.
    return `date(${seconds}, 'weekday 0', '-6 days')`;
  }

  protected aggregate(
    repository: Repository<ZObject>,
    selection: EventLogSelection,
  ): string {
    if (selection.op === "count" && selection.column === "*") {
      return "COUNT(*)";
    }
    const column = this.columnName(repository, selection.column);
    if (selection.op === "count") return `COUNT(${column})`;
    if (selection.op === "distinct") return `COUNT(DISTINCT ${column})`;
    return `${selection.op.toUpperCase()}(${column})`;
  }

  /**
   * SQLite stores a boolean as 0 or 1 and its drivers refuse to bind one.
   */
  protected bindable(value: string | number | boolean): string | number {
    if (typeof value === "boolean" && this.database.dialect !== "postgresql") {
      return value ? 1 : 0;
    }
    return value as string | number;
  }

  /**
   * A grouped column back in its declared type: SQLite answers a boolean as
   * 0 or 1, and Postgres a bigint as a string.
   */
  protected decode(schema: ZType, value: unknown): Value {
    if (value === null || value === undefined) return null;
    const type = OrmEventLogProvider.baseType(schema);
    if (type === "boolean") return value === true || Number(value) === 1;
    if (type === "number" || type === "int" || type === "bigint") {
      return Number(value);
    }
    return value as Value;
  }

  /**
   * The type of a column under its nullable and optional wrappers.
   */
  public static baseType(schema: ZType): string | undefined {
    let def = (schema as unknown as { def?: Record<string, unknown> }).def;
    while (def?.innerType) {
      def = (def.innerType as { def?: Record<string, unknown> }).def;
    }
    return def?.type as string | undefined;
  }
}
