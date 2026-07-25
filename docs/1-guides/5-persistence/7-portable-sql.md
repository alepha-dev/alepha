# Portable SQL

Repository methods cover most queries, but analytics work — grouping by day, measuring elapsed time, bounding a rolling window — needs raw SQL. Written by hand, that SQL is not portable.

```typescript
import { $inject, z } from "alepha";
import { $repository, DatabaseProvider, SqlExpressionProvider } from "alepha/orm";
import { sql } from "drizzle-orm";
```

## Why dates diverge

There is one root cause: **Postgres stores timestamps as native timestamps, SQLite stores them as epoch-millisecond integers.** Cloudflare D1 is SQLite, so any app that develops on Postgres and deploys on D1 hits this on its first chart.

The result is code like this, doubled for every expression:

```typescript
// Don't do this.
const isSqlite = this.database.dialect === "sqlite";
const day = isSqlite
  ? sql`DATE(${this.quests.table.createdAt} / 1000, 'unixepoch')`
  : sql`DATE(${this.quests.table.createdAt})`;
```

Two branches, two chances to get it wrong, and no test catches a divergence until someone compares a local chart against production.

## `SqlExpressionProvider`

Inject it and write the expression once:

```typescript
class CampaignStatsController {
  protected readonly sqlx = $inject(SqlExpressionProvider);
  protected readonly database = $inject(DatabaseProvider);
  protected readonly quests = $repository(quests);

  questsPerDay = async () => {
    return this.database.run(
      sql`SELECT ${this.sqlx.dateDay(this.quests.table.createdAt)} AS day,
                 COUNT(*) AS total
          FROM ${this.quests.table}
          GROUP BY 1
          ORDER BY 1`,
      z.object({ day: z.text(), total: z.coerce.number() }),
    );
  };
}
```

### `dateDay(column)`

A timestamp truncated to its day, as sortable `'YYYY-MM-DD'` **text**.

Text on both dialects is deliberate. Postgres `DATE(col)` decodes to a `Date` while SQLite yields a string, so a single result schema could not describe both. Returning text means one `z.text()` covers every database.

### `dateWeek(column)`

A sortable ISO year-week label, e.g. `'2026-W11'`.

ISO on both dialects, also deliberate. Postgres `IYYY-IW` and SQLite `%Y-%W` are *different numbering schemes* — `%W` counts Monday-started weeks from the first Monday of the year (`00`–`53`), ISO weeks run `01`–`53` with different year-boundary rules. Hand-written code that pairs them produces different labels for the same row depending on where it runs.

SQLite has no ISO week function, so this uses the Thursday rule: the ISO week of a date is the week containing the Thursday of that date's Monday-started week, and the ISO year is that Thursday's calendar year.

```typescript
const weekly = await this.database.run(
  sql`SELECT ${this.sqlx.dateWeek(this.quests.table.completedAt)} AS week,
             COUNT(*) AS total
      FROM ${this.quests.table}
      WHERE ${this.quests.table.completedAt} IS NOT NULL
      GROUP BY 1 ORDER BY 1`,
  z.object({ week: z.text(), total: z.coerce.number() }),
);
```

### `dateDiff(end, start, unit)`

Elapsed time between two timestamp columns, as a floating-point count of `"seconds" | "minutes" | "hours" | "days"`.

`NULL` on either side propagates rather than collapsing to zero, so it composes with `AVG` over partially-complete rows — an unfinished row is skipped, not averaged in as `0`.

```typescript
const [cycle] = await this.database.run(
  sql`SELECT AVG(${this.sqlx.dateDiff(
        this.quests.table.completedAt,
        this.quests.table.acceptedAt,
        "hours",
      )}) AS hours
      FROM ${this.quests.table}`,
  z.object({ hours: z.number().nullable() }),
);
```

The Postgres form is cast to `double precision`. Without it, `EXTRACT(EPOCH …)` yields `numeric`, which the Postgres driver returns as a **string** to protect precision — so the same query would decode as a number on SQLite and a string on Postgres. The cast makes both a JS number, which is why the schema above is `z.number()` and not `z.coerce.number()`.

### `ago(amount, unit)`

A timestamp `amount × unit` before now, comparable against a timestamp column.

```typescript
const recent = await this.database.run(
  sql`SELECT COUNT(*) AS n FROM ${this.quests.table}
      WHERE ${this.quests.table.completedAt} >= ${this.sqlx.ago(7, "days")}`,
  z.object({ n: z.coerce.number() }),
);
```

Instant-aligned on both dialects, not midnight-aligned. If you want calendar-day boundaries, bucket with `dateDay` instead of reaching for `ago` — mixing the two is how a "last 7 days" window comes to mean different things on different databases.

## `COUNT` and `AVG` still need coercion

The helpers cover their own output, not yours. Postgres returns `COUNT(*)` (bigint) and bare `AVG(numeric)` as strings; SQLite returns numbers. For aggregates you write yourself, decode with `z.coerce.number()`:

```typescript
z.object({ total: z.coerce.number() })
```

`dateDiff` is the exception — it casts, so `z.number()` is correct there.

## When to keep writing raw SQL

These helpers are date-shaped on purpose. Reach for raw `sql` when the expression is not:

- upserts and counter increments (`SET count = count + 1`)
- `LIKE` / JSON containment scans
- window functions, `CASE` ladders, recursive CTEs

Those are portable already, or portable enough that a helper would add indirection without removing a branch. The test for whether something belongs here is simple: **does it need a `dialect ===` check?** If yes, it is a candidate. If no, write the SQL.

## Testing

Anything built on these helpers should be tested against both dialects, because that is the whole point. The framework's own suite uses a shared test function run twice:

```typescript
describe("dateWeek", () => {
  it("should return ISO week labels (sqlite)", async () => {
    await testDateWeek(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("should return ISO week labels (postgres)", async () => {
    await testDateWeek(Alepha.create().with(AlephaOrmPostgres));
  });
});
```
