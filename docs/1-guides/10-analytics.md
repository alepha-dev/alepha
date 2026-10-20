# Analytics

`$analytics` gives your app a portable, aggregate-on-read analytics dataset. You declare the
dimensions you group and filter by and the measures you aggregate once, and the same
declaration runs unchanged on a relational database, in memory for tests, and on Cloudflare
Workers Analytics Engine in production. Application code never names a backend - which one is
bound is a runtime decision made by the `alepha/api/analytics` module.

It ships inside the `alepha` package as an `api/*` sub-module, with the retention sweep
(`AlephaApiAnalyticsRollup`, covered below) and the admin surface (`AlephaApiAnalyticsAdmin`:
dataset listing and validated aggregate queries at `/api/admin/analytics/*`, gated on
`admin:analytics:read`) as separate opt-in modules alongside it:

```typescript
import { $analytics } from "alepha/api/analytics";
```

## Declaring a dataset

A dataset is `index` (which dimension Analytics Engine samples on), `dimensions` and `measures`
(each a `z.object(...)`, exactly like an `$entity` schema), `slots` (the wire format - see
[below](#the-analytics-engine-slot-map-is-a-wire-format)), and an optional `retention`:

```typescript check
import { z } from "alepha";
import { $analytics } from "alepha/api/analytics";

class PageViews {
  views = $analytics({
    index: "app",
    dimensions: z.object({ app: z.text(), path: z.text(), country: z.text() }),
    measures: z.object({ count: z.integer() }),
    // Append only. A new dimension goes on the END of this list.
    slots: { dimensions: ["app", "path", "country"], measures: ["count"] },
    retention: { hot: "60d", rollup: "day", cold: "400d" },
  });

  async onPageView(app: string, path: string, country: string) {
    await this.views.record({ app, path, country, count: 1 });
  }

  async topPaths(app: string) {
    return this.views.query({
      since: "2026-01-01",
      where: { app },
      groupBy: ["path"],
      select: { count: "sum" },
      orderBy: { key: "count", direction: "desc" },
      limit: 20,
    });
  }
}
```

`dimensions` are the low-cardinality strings you group and filter by. `measures` are the numbers
you aggregate. Both read exactly like an entity schema because that is the point - a dataset
should not require learning a second schema language.

### Dataset names must be snake_case

A dataset defaults its storage-facing name to the property key it is declared on (`views`
above), the same way `$storage` names a bucket from its property key. That name has to match
`/^[a-z][a-z0-9_]*$/` - lowercase letters, digits and underscores, starting with a letter -
because it becomes a relational table name fragment **and** the Analytics Engine `blob1`
discriminator (Analytics Engine has no table concept, so several datasets share one binding and
need something to tell their rows apart). A camelCase property key, which is the normal Alepha
convention everywhere else, is rejected at `onInit` with a message suggesting the snake_case
rename. If you want to keep the camelCase field, pass an explicit `name`:

```typescript
pageViews = $analytics({
  name: "page_views",
  index: "app",
  dimensions: z.object({ app: z.text() }),
  measures: z.object({ count: z.integer() }),
  slots: { dimensions: ["app"], measures: ["count"] },
});
```

### Reserved names

`time_bucket` is the reserved column name the relational backend uses to store the bucket
itself, so it cannot be declared as a dimension or a measure. `day`, `hour` and `minute` are
reserved as _dimension_ names for the same reason - they are the pseudo-dimensions `query()` exposes for
grouping by time (see [Querying](#querying) below), and a real dimension with any of those names
would be permanently shadowed by them.

## Recording

```typescript
await this.views.record({ app, path, country, count: 1 });

// Or a batch:
await this.views.recordMany([
  { app, path, country: "FR", count: 1 },
  { app, path, country: "DE", count: 1 },
]);
```

Every row is placed by `at`, the instant it was taken in milliseconds, which defaults to
`DateTimeProvider`'s now: it decides the row's hour bucket, and it is the timestamp a `last` fold
compares (see [Folds](#folds-sum-min-max-and-last)). One timestamp, not two. You can also supply
the bucket yourself (`{ ...row, hour: "2026-08-09T14" }`). Passing `hour` explicitly matters for anything
batched or retried: Analytics Engine stamps its own write-time timestamp and cannot backdate a
point, so a retried envelope has to carry the bucket it originally computed, or it lands in the
wrong hour for reasons that have nothing to do with sampling.

Rows of one batch that share a bucket and every dimension are merged before they reach the
backend, so two readings of the same device in the same bucket are one stored row, on every
backend.

### Device clocks are clamped, not trusted

`at` usually comes from a device, and device clocks drift. Two rules apply in `recordMany`, each
logged at `debug` with the dataset name and the offset:

- An `at` more than `AnalyticsPrimitive.MAX_CLOCK_SKEW` (5 minutes) ahead of the server clock is
  clamped to now. A clock running a day ahead would otherwise write into a bucket that does not
  exist yet, and pin `last` for every bucket it later folds into.
- An `at` older than the finest tier's `keep` (`retention.hot`) is dropped: the next sweep
  would delete it anyway. With no retention declared, it is kept.

Only `at` is clamped. An explicit `hour` is your own decision and is stored as given.

## Querying

```typescript
const result = await this.views.query({
  since: "2026-01-01",
  where: { app: "lore", country: { inArray: ["FR", "DE"] } },
  groupBy: ["path"],
  select: { count: "sum" },
  orderBy: { key: "count", direction: "desc" },
  limit: 20,
});
```

A query gives exactly one of two windows. `since` and `until` (optional) are inclusive UTC days,
`YYYY-MM-DD`. Omitting `until` reads up to the newest bucket; set it to compare complete days
(yesterday against the day before) rather than a window that ends mid-day.

### Instant windows: `from` and `to`

A monitoring chart asks for "the last 15 minutes" or "from 08:00 to 10:30" in the operator's
timezone. `from` and `to` are ISO 8601 instants **with an offset**; an instant without one is
refused, because the server never guesses a timezone:

```typescript
await this.ticks.query({
  from: "2026-10-18T08:00:00+04:00", // Dubai
  to: "2026-10-18T10:30:00+04:00",
  groupBy: ["minute"],
  select: { validations: "sum" },
});
```

- `to` is optional (up to the newest bucket) and **exclusive**, so consecutive windows
  (`[08:00, 09:00)`, `[09:00, 10:00)`) never count a bucket twice.
- `from` pairs with `to` and `since` with `until`; a query naming both forms, neither, or a crossed
  pair is refused.
- Each tier floors `from` and ceils `to` to its own resolution. Where a tier is coarser than a
  bound (the hour tier asked for 08:30), the bucket that straddles it is **read whole** rather than
  dropped, since dropping it would silently lose readings the window asked for, and the result
  carries `coarsened: true`: at least one returned bucket extends outside `[from, to)`. A
  `since`/`until` query is never coarsened.

**Days are UTC days.** The day tier is keyed on UTC midnight, with no per-dataset offset. Instants
cover any sub-day window in any timezone, but a local-day total (Dubai midnight to midnight is
20:00 to 20:00 UTC) is exact only while a tier finer than a day still holds the range. Once it has
folded into days, the same `from`/`to` returns the whole UTC days it overlaps, flagged `coarsened`.
An app that needs local-day totals over a long range keeps its hour tier that long (see
[Retention and rollup](#retention-and-rollup)).

Analytics Engine answers `since`/`until` only, and refuses `from`/`to` with an error.

`where` supports equality and `{ inArray: [...] }` - the same operator name the ORM's
[repository filters](/docs/guides-persistence-repository) use, no ranges. `groupBy` takes any
declared dimension, plus the pseudo-dimensions `"minute"`, `"hour"` and `"day"` - grouping by
`"day"` folds hour buckets into a daily timeline with no date arithmetic on the caller's side,
whichever backend answers the query.

### Sub-hour resolution

A monitoring view asks for "the last 15 minutes" or "the last 6 hours by 5 minutes", which an
hour bucket cannot answer. A dataset declares its finest bucket with `resolution`: `"1m"`, `"5m"`,
`"15m"` or `"1h"` (the default, so existing datasets keep their keys).

```typescript
ticks = $analytics({
  index: "deviceId",
  resolution: "5m",
  dimensions: z.object({ deviceId: z.text() }),
  measures: z.object({ validations: z.integer() }),
  slots: { dimensions: ["deviceId"], measures: ["validations"] },
});
```

Sub-hour keys are `YYYY-MM-DDTHH:MM`, the minute floored to the resolution, so a coarser key is
still a prefix of a finer one. `groupBy: ["minute"]` returns the stored key, `"hour"` its first 13
characters and `"day"` its first 10, whatever the resolution. A row that has already folded into
the day tier keeps its day key under `minute` and `hour`: the resolution of old data is coarser,
the totals are not. Sub-hour buckets fold straight into days.

A sub-hour dataset places each reading with `at`; the explicit `hour` override exists on `"1h"`
datasets only, and is validated there. Analytics Engine refuses any `resolution` other than
`"1h"` at boot: its forward to the relational tier and its watermark are hour-based.

## Folds: sum, min, max and last

A measure declares how its values combine, in `folds`. An undeclared measure folds `["sum"]`,
which is a counter: validations per hour, page views per path. A gauge (temperature, cash level,
ticket stock, battery) is meaningless as a sum and declares `min`, `max` and `last` instead:

```typescript
readings = $analytics({
  index: "deviceId",
  dimensions: z.object({ deviceId: z.text() }),
  measures: z.object({ temperature: z.number(), validations: z.integer() }),
  folds: { temperature: ["min", "max", "last"] },
  slots: { dimensions: ["deviceId"], measures: ["temperature", "validations"] },
});

await this.readings.record({
  deviceId,
  temperature: 21.5,
  validations: 3,
  at: sentAt,
});
```

`select` takes one fold or several. One fold keeps the measure's own name as the key; an array
returns `<measure>_<fold>` keys, which is what a band chart (min and max as the band, last as the
line) needs in one round trip. A fold the measure does not declare is refused.

```typescript
await this.readings.query({
  since: "2026-10-01",
  groupBy: ["hour"],
  select: { temperature: ["min", "max", "last"], validations: "sum" },
});
// [{ hour: "2026-10-01T08", temperature_min: 19, temperature_max: 23.5,
//    temperature_last: 21.5, validations: 41 }, ...]
```

- **A missing reading is absent, never `0`.** A row may omit a gauge; nothing is stored for it,
  and a fold over buckets that hold no reading comes back `null` (sorted last by `orderBy`, in
  either direction). A sum-only measure keeps its old behaviour: omitted counts as `0`.
- **`last` is the reading with the latest `at`.** Equal `at` keeps the larger value, on every
  backend, so memory and SQL agree. Arrival order does not matter: a device catching up after an
  outage lands in its old buckets and is folded by the next sweep like any other row.
- **`sum` may sit beside gauge folds** (`["sum", "min", "max"]`): with a count-as-sum measure, it
  gives a mean caller-side.

**Storage.** A sum-only measure is one column named after itself, exactly as before folds
existed, so declaring `folds` on another measure changes no existing column. A measure with any
other fold gets one nullable column per fold, `<measure>_<fold>`, plus `<measure>_last_at` (a
bigint of milliseconds) when it declares `last`. A declared name equal to a derived column (a
measure called `temperature_min` beside a gauge `temperature`) is refused at boot.

**Every fold survives a rollup.** When hour buckets fold into day buckets (see
[Retention and rollup](#retention-and-rollup)), the total, the extremes and the last value of the
day are computed from those of its hours alone, so no number the UI shows changes; only the time
axis coarsens. That is the rule every fold has to pass, and the reason the set stops here:

- **`avg` and percentiles are not folds.** The mean of several means is wrong the moment the
  buckets differ in size, and the p75 of several distributions is not the mean of their p75s.
- **`min`, `max` and `last` need an exact backend.** Analytics Engine samples, and every stored row
  carries a `_sample_interval`: `sum(x * _sample_interval)` reconstructs a true total from a
  sampled window, but if the sampler drops the row holding the true extreme or the last reading,
  nothing recovers it. A dataset declaring any of them is **refused at boot** on Analytics Engine
  (`AnalyticsProvider.exact` is `false` there) rather than served silently wrong. It runs on the
  relational and in-memory backends.

### There is no `count` aggregate: declare a count measure and sum it

An earlier version of this package also accepted `"count"`, meaning "the number of stored rows"
rather than a sum of any measure. That number is not portable: relationally it was `COUNT(*)`,
and in memory it was one increment per recorded array entry - not the same number on identical
writes (a relational upsert accumulates repeated writes into one row; an in-memory record pushes
a new one), and it does not survive a rollup on **either** backend, because folding rows into a
day bucket collapses the very thing a row count was measuring. Summing eight `sum`s across a
rollup boundary reproduces the pre-rollup total exactly; summing eight `count`s does not, because
after the fold there are fewer, larger rows to count. `count` was removed rather than special-cased:
a fold in this seam has to be correct
after a rollup and identical across every backend, not merely plausible on the one you tested
against.

The portable replacement is the pattern [Lore](https://github.com/alepha-dev/lore)'s own `sigil_views` dataset already uses:
declare a measure that is `1` per event (call it `count`, or anything else) and `sum` it. That is
an ordinary `sum`, so it survives a rollup and a sampled backend for the same reason any other
measure does:

```typescript
measures: z.object({ count: z.integer() }),
```

```typescript
await this.views.record({ app, path, country, count: 1 });
```

```typescript
select: { count: "sum" },
```

Two patterns cover what the missing aggregates would have given you, and both stay
caller-side and obvious rather than needing a merge-rule enforcement layer inside the package:

- **A mean**: declare a `sum` measure and a count-as-sum measure (see above), and divide them
  yourself once the query returns.
- **A percentile**: see [The histogram pattern](#the-histogram-pattern) below.

### What analytics cannot do

A dataset cannot answer "how many _distinct_ visitors" - a distinct count cannot survive
sampling (a sampled window drops rows, so a naive `COUNT(DISTINCT ...)` under-counts) or a
rollup (once hour buckets fold into a day bucket, which visitor hashes contributed to which hour
is gone). Lore keeps unique-visitor counts on its own table
(`LoreAnalyticsStore`/`sigil_uniques_daily`) for exactly this reason - see that class's doc for
the full argument. If your app needs distinct counts, they need their own storage; `$analytics`
is not the tool for them.

## The histogram pattern

A percentile does not merge across buckets, but a histogram does - so a percentile is modelled
as an ordinary dimension holding the bucket index, with `count` (or whatever you call the
measure) as the thing you sum. This is exactly how Lore tracks Web Vitals:

```typescript
import { z } from "alepha";
import { $analytics } from "alepha/api/analytics";

class WebVitals {
  vitals = $analytics({
    name: "sigil_vitals",
    index: "sigilId",
    dimensions: z.object({
      sigilId: z.uuid(),
      metric: z.string(),
      path: z.string(),
      bucket: z.number(),
    }),
    measures: z.object({ samples: z.number() }),
    slots: {
      dimensions: ["sigilId", "metric", "path", "bucket"],
      measures: ["samples"],
    },
    retention: { hot: "30d", rollup: "day", cold: "400d" },
  });
}
```

`bucket` is not special machinery - it is the histogram's bucket index, declared as an ordinary
`z.number()` dimension. Recording one vital sample means bucketing the raw value yourself (a CLS
score, an LCP duration in milliseconds) into a bucket index and incrementing that bucket's
`samples` count. To read a percentile back, `query()` grouped by `["metric", "bucket"]` returns
the whole histogram as flat `(metric, bucket, samples)` rows, and the caller walks it - sums
`samples` from the bottom until the running total passes the target percentile of the overall
count, and that bucket's midpoint is the estimate. The walk (and any un-scaling a particular
metric's buckets need) belongs entirely to caller-side code; `$analytics` only ever stores and
returns counts per bucket.

## Retention and rollup

`retention` is an ordered chain of tiers, finest first. Each tier keeps its buckets for `keep`,
then the hourly sweep folds them into the next, coarser tier:

```typescript
retention: [
  { resolution: "1m", keep: "48h" },
  { resolution: "1h", keep: "30d" },
  { resolution: "1d", keep: "400d" },
],
```

A 1-minute dataset at 10k devices cannot keep minutes for 60 days; with this chain it keeps
minutes for two days, hours for a month and days for a year. Windows are written `<n>m`, `<n>h`
or `<n>d`. The chain is checked at boot:

- the first tier's resolution is the dataset's `resolution`;
- each next resolution is strictly coarser than the previous one and a multiple of it
  (`1m`, `5m`, `15m`, `1h`, `1d`);
- each `keep` is a whole number of its tier's buckets, at least one bucket of the next tier
  (the sweep folds whole buckets only), and at least as long as the previous tier's `keep`, since
  a shorter one later in the chain would delete readings before they are ever folded;
- only the last tier may omit `keep`, and is then kept forever.

The original shape is still accepted and is the two-tier chain it always described:

```typescript
retention: { hot: "60d", rollup: "day", cold: "400d" }
// is
retention: [
  { resolution: "1h", keep: "60d" }, // the dataset's resolution
  { resolution: "1d", keep: "400d" },
]
```

Without `hot`, the dataset never folds and never prunes. `cold` must be at least as long as
`hot`, by the same rule as any other `keep`.

Every fold **collapses rather than deletes**: folding a tier into the next groups by every
declared dimension exactly as before and folds each measure by its own folds (see
[Folds](#folds-sum-min-max-and-last)) - no dimension is dropped or merged away, and no total,
extreme or last value your UI shows ever changes. Only the resolution of the time axis does.
Deletion only ever happens past the last tier's `keep`, to rows already folded into it. A query
reads every tier and merges them, so a window spanning tiers comes back whole.

**Storage.** Each tier is a table with the same columns and unique index. The finest keeps
`analytics_<name>_raw` and the coarsest `analytics_<name>_rolled`, the names every dataset
already had; each tier in between is `analytics_<name>_<resolution>`
(`analytics_device_metrics_1h`). Adding a tier to the middle of a chain adds a table, and renames
none, so an existing dataset's data stays where it is. Its migration is an ordinary
`alepha db migrations create`.

**The sweep stays hourly**, whatever the finest resolution: a minute tier can only fold whole
hours into an hour tier, so a faster sweep would fold nothing more. Each sweep folds at most
`AnalyticsRollupJobs.MAX_BUCKETS_PER_SWEEP` source buckets per tier (336: fourteen days of
hours), and catches up over later sweeps.

### Analytics Engine keeps two tiers, and roughly 90 days of hours

Analytics Engine serves the original two-tier chain only: hours, then days. A longer chain is
**rejected at registration** on that backend. Cloudflare also keeps Analytics Engine data for
approximately 90 days regardless of what you declare, so a finest tier keeping longer
(`retention.hot` over `"90d"`) is rejected there too, at boot, rather than letting a report
quietly come up short months later. The relational and memory backends honour any valid chain.

### Declaring `retention` does nothing on its own

This is the sharpest edge in the whole primitive, worth stating plainly: **nothing in
`alepha/api/analytics` enforces `retention` automatically.** Registering `$analytics()` datasets -
importing `AlephaApiAnalytics` - wires the provider and lets you `record()`/`query()`, full stop.
The hourly sweep that actually folds and prunes rows lives in a **separate module**,
`AlephaApiAnalyticsRollup`, which your app has to import explicitly alongside `AlephaApiAnalytics`:

```typescript
import { Alepha } from "alepha";
import {
  AlephaApiAnalytics,
  AlephaApiAnalyticsRollup,
} from "alepha/api/analytics";

const alepha = Alepha.create()
  .with(AlephaApiAnalytics)
  .with(AlephaApiAnalyticsRollup);
```

Forgetting `AlephaApiAnalyticsRollup` is silent in the sense that nothing throws: `record()` and
`query()` keep working normally, and the raw table simply grows forever. It is not _completely_
silent, though - a boot-time `log.warn` from the retention guard names every dataset that
declares a window on its finest tier (`retention.hot`) while no rollup job was ever constructed, specifically so this mistake
does not stay invisible once the app is actually running.

The split exists because `AnalyticsRollupJobs` is built on `$job`, and `$job` always needs a
real database connection (it holds a `$repository` on its own job-execution table), in every
environment including tests. Folding the rollup job into `AlephaApiAnalytics` directly would mean
merely declaring one `$analytics()` field - the one thing this package promises works with no
database at all - starts requiring a live database connection to boot.

## Result epistemics: `estimated` and `sampleInterval`

Every `query()` result carries more than rows:

```typescript
export interface AnalyticsResult {
  rows: Array<Record<string, string | number>>;
  estimated: boolean;
  sampleInterval?: number;
}
```

- **`estimated`** is `false` on the relational and memory backends - they never sample, so their
  numbers are exact by construction. It is `true` on Analytics Engine, which samples under load.
- **`sampleInterval`** is the largest `_sample_interval` seen in the window, when the backend
  samples. A value of `1` means no sampling actually occurred in that window, so the numbers are
  exact despite `estimated` being `true` - the common case at low traffic. A UI should not
  qualify the numbers ("approximate") when `sampleInterval === 1`; it should when it is greater.

The result carries this rather than a UI having to know which backend answered it, so ignoring
`estimated` is a visible choice made in the reading code, not an accident of which environment
happened to be running.

## Backends

The bound provider is a runtime decision the module makes, never something application code
chooses:

| Environment                                    | Provider                  | Behavior                                     |
| ---------------------------------------------- | ------------------------- | -------------------------------------------- |
| Tests (`alepha.isTest()`)                      | `MemoryAnalyticsProvider` | In-memory, exact, no sampling                |
| Worker with `CLOUDFLARE_ANALYTICS_DATASET` set | `WaeAnalyticsProvider`    | Workers Analytics Engine, samples under load |
| Node / Bun, or a Worker without that variable  | `OrmAnalyticsProvider`    | Relational tables, exact, no sampling        |

`AlephaApiAnalytics` and most other Alepha modules ship a memory implementation as the
substitutable default - see [Unit Tests](/docs/guides-testing-unit-tests) for the general
shape.

### The Analytics Engine slot map is a wire format

Analytics Engine has no columns, only 20 positional `blob` slots and 20 positional `double`
slots per data point - and two blob slots are reserved, so a dataset can declare at most
18 dimensions and 20 measures before `AnalyticsSlotMap` throws at boot.

Which name occupies which position is **declared, not derived**. `slots` is a pair of ordered
name lists - the first dimension is `blob3`, the first measure is `double1` - and it is
required on every dataset, on every backend, from the first line it is written on:

```typescript
slots: {
  dimensions: ["app", "path", "country"],
  measures: ["count"],
},
```

Three rules follow, and they are the whole of it:

- **Reordering the `dimensions` / `measures` object literal is a safe no-op.** Nothing reads its
  key order.
- **Adding is append-only.** A new name goes on the END of its list and takes the next free
  slot. Inserting or reordering shifts every later name by a position, and since Analytics
  Engine addresses fields positionally and has no update or delete API, every row already
  written is then read under the wrong field, permanently.
- **Renaming is breaking, and fails loudly.** The new name is in `dimensions` and not in
  `slots`, so the dataset refuses to boot with a message naming both ways out - rather than
  reading history under a meaning it never had.

To retire a name, delete it from `dimensions` / `measures` and **leave it in the list**. Its
slot stays reserved and nothing after it moves.

Slots are meaningless on the relational and in-memory backends, which address columns by name.
They are still required there, because a check that only runs on the runtime that deploys is a
check that never runs in CI.

> This replaced a derivation from alphabetically sorted names, which had the first and third
> properties and not the second: a new dimension landed wherever it sorted and pushed every
> later one along. Adding a `referrer` dimension to a live dataset in 2026-08 moved its index
> dimension by three slots and made eight days of stored rows match no filter at all. They are
> still there, unreadable, and there is no API to repair them with.
>
> The hourly sweep forwards Analytics Engine rows into the relational cold tier, which validates
> every dimension against its declared type, so a row like those is skipped there rather than
> refused: one `log.warn` per sweep names the dimension and what it held. Until that existed,
> one such row failed the whole forward, and with it every rollup of its dataset.

### The first sweeps catch up a few days at a time

On Analytics Engine the sweep forwards at most 2,000 rows into the cold tier per dataset per
run, cut at a day boundary, and folds only the days it forwarded; the next run resumes where it
stopped. A dataset that has never been rolled up, or has fallen weeks behind, therefore catches
up over several hourly runs rather than one. The bound exists because Cloudflare D1 binds at
most 100 values per statement and caps the statements one Worker invocation may run: a row of a
ten-dimension dataset binds fourteen values, so forwarding a month of hourly rows in one run
would not fit. The fold itself is a single `INSERT … SELECT` in the database, whatever the
backlog.

## Registering the module

A real example, from [Lore](https://github.com/alepha-dev/lore):

```typescript
import { $module } from "alepha";
import { AlephaApiAnalyticsRollup } from "alepha/api/analytics";

import { LoreAnalytics } from "./entities/loreAnalytics.ts";

export const LoreApi = $module({
  name: "lore.api",
  // `$analytics()` (used by `LoreAnalytics`) auto-wires `AlephaApiAnalytics` itself
  // the moment a dataset is injected - the same module-tagging mechanism
  // `$repository` uses for `AlephaOrm`. The retention sweep does not auto-wire:
  // it needs its own explicit import, or retention silently does nothing.
  imports: [AlephaApiAnalyticsRollup],
  services: [LoreAnalytics /* ...the rest of the app's services */],
});
```

`LoreAnalytics` itself just declares two datasets - this is close to the real
`entities/loreAnalytics.ts` in the Lore repository:

```typescript
import { z } from "alepha";
import { $analytics } from "alepha/api/analytics";
import { db } from "alepha/orm";

import { sigils } from "./sigils.ts";

export class LoreAnalytics {
  public readonly views = $analytics({
    name: "sigil_views",
    index: "sigilId",
    dimensions: z.object({
      // db.ref works inside a dimension exactly like inside an $entity schema:
      // the relational backend gets a real foreign key with ON DELETE CASCADE,
      // Memory and Analytics Engine are unaffected since both only ever read
      // the dimension names, never the zod metadata attached to them.
      sigilId: db.ref(z.uuid(), () => sigils.cols.id, { onDelete: "cascade" }),
      path: z.string(),
      country: z.string(),
    }),
    measures: z.object({ count: z.number() }),
    slots: {
      dimensions: ["sigilId", "path", "country"],
      measures: ["count"],
    },
    retention: { hot: "30d", rollup: "day", cold: "400d" },
  });
}
```

## Scoping the query builder to one tenant

`AlephaApiAnalyticsAdmin` serves every dataset in the container to anyone holding
`admin:analytics:read`. To offer the same query builder to a non-admin over their
own slice of the data, keep the service and write your own controller around it:
both of its methods take an optional scope.

```typescript
import { $inject, z } from "alepha";
import {
  adminAnalyticsQuerySchema,
  adminAnalyticsResultSchema,
  AdminAnalyticsService,
  adminDatasetSchema,
} from "alepha/api/analytics";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

export class TenantAnalyticsController {
  protected service = $inject(AdminAnalyticsService);

  listTenantDatasets = $action({
    use: [$secure({ permissions: ["tenant:read"] })],
    method: "GET",
    path: "/tenants/:tenantId/analytics/datasets",
    schema: {
      params: z.object({ tenantId: z.uuid() }),
      response: z.array(adminDatasetSchema),
    },
    handler: async ({ params }) => {
      // Prove the caller may read THIS tenant before anything else. That check
      // is the one thing the framework cannot write for you.
      return this.service.listDatasets({ pin: { tenantId: params.tenantId } });
    },
  });

  queryTenantDataset = $action({
    use: [$secure({ permissions: ["tenant:read"] })],
    method: "POST",
    path: "/tenants/:tenantId/analytics/datasets/:name/query",
    schema: {
      params: z.object({ tenantId: z.uuid(), name: z.text() }),
      body: adminAnalyticsQuerySchema,
      response: adminAnalyticsResultSchema,
    },
    handler: async ({ params, body }) => {
      return this.service.queryDataset(params.name, body, {
        pin: { tenantId: params.tenantId },
      });
    },
  });
}
```

`pin` does three things, and the first is what makes a generic UI safe on a
scoped surface:

- **It removes the pinned dimensions from the published descriptors.** A scoped
  caller is never told `tenantId` exists, so a query builder driven by those
  descriptors cannot offer it as a group-by key, as a filter, or as a filter
  value - without a single line of that UI knowing a scope is in play.
- **It refuses a query that names a pinned key**, in `where` or in `groupBy`,
  with a `BadRequestError`. The pin is a vocabulary restriction, not a default
  the caller may override. Silently overwriting would be worse than refusing:
  the caller believes it filtered, and it did not.
- **It hides datasets it cannot narrow.** A dataset that does not declare every
  pinned dimension is absent from `listDatasets` and answers `NotFoundError`
  from `queryDataset`, because the alternative is serving it whole to a scoped
  caller - exactly the moment the scope mattered most.

That last point makes the allowlist derived rather than written: a new dataset
carrying `tenantId` appears with no change to the controller, and one without it
can never appear at all.

> **The scope is not a UI concern.** Anyone can post the request body
> themselves, so a control the page hides protects nothing. `pin` is enforced in
> the service, behind your own authorization check, which is why the two live
> together in the handler above.

On the client, `@alepha/ui`'s `AdminAnalytics` takes an optional `transport`
so the same panel can point at this controller instead of the admin one:

```tsx
<AdminAnalytics
  transport={{
    listDatasets: () => client.listTenantDatasets({ params }),
    queryDataset: (dataset, body) =>
      client.queryTenantDataset({ params: { ...params, name: dataset }, body }),
    path: (dataset) =>
      `/api/tenants/${tenantId}/analytics/datasets/${dataset}/query`,
  }}
/>
```

Memoise that object: it is an effect dependency inside the panel, so a fresh one
per render re-fires every query forever.

## Testing

`MemoryAnalyticsProvider` is bound automatically under `alepha.isTest()` - no substitution
needed, and no sampling to account for in assertions:

```typescript
import { Alepha, z } from "alepha";
import { $analytics, AlephaApiAnalytics } from "alepha/api/analytics";

class Stats {
  views = $analytics({
    index: "app",
    dimensions: z.object({ app: z.text() }),
    measures: z.object({ count: z.integer() }),
    slots: { dimensions: ["app"], measures: ["count"] },
  });
}

const alepha = Alepha.create().with(AlephaApiAnalytics);
const stats = alepha.inject(Stats);
await alepha.start();

await stats.views.record({ app: "lore", count: 1 });
const result = await stats.views.query({
  since: "2026-01-01",
  select: { count: "sum" },
});

expect(result.estimated).toBe(false);
expect(result.rows[0].count).toBe(1);
```
