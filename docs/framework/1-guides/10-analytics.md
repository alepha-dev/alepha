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
import { $analytics } from "alepha/api/analytics";
import { z } from "alepha";

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
itself, so it cannot be declared as a dimension or a measure. `day` and `hour` are reserved as
_dimension_ names for the same reason - they are the pseudo-dimensions `query()` exposes for
grouping by time (see [Querying](#querying) below), and a real dimension with either name would
be permanently shadowed by them.

## Recording

```typescript
await this.views.record({ app, path, country, count: 1 });

// Or a batch:
await this.views.recordMany([
  { app, path, country: "FR", count: 1 },
  { app, path, country: "DE", count: 1 },
]);
```

Every row is stamped with an hour bucket, taken from `DateTimeProvider` unless you supply one
yourself (`{ ...row, hour: "2026-08-09T14" }`). Passing `hour` explicitly matters for anything
batched or retried: Analytics Engine stamps its own write-time timestamp and cannot backdate a
point, so a retried envelope has to carry the bucket it originally computed, or it lands in the
wrong hour for reasons that have nothing to do with sampling.

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

`where` supports equality and `{ inArray: [...] }` - the same operator name the ORM's
[repository filters](/docs/guides-persistence-repository) use, no ranges. `groupBy` takes any
declared dimension, plus the pseudo-dimensions `"hour"` and `"day"` - grouping by `"day"` folds
hour buckets into a daily timeline with no date arithmetic on the caller's side, whichever
backend answers the query.

## The aggregate set is deliberately small

`select` only accepts `"sum"` as an aggregate. That is not a temporary gap - `sum` is the
complete set of aggregates that are simultaneously:

- **Mergeable across a rollup boundary.** When the hourly rollup folds a day's worth of hour
  buckets into one day bucket (see [Retention and rollup](#retention-and-rollup)), the fold
  itself has to be an aggregate: summing eight `sum`s produces the correct day-level `sum`. There
  is no equivalent fold for an average or a percentile - the mean of several means is wrong the
  moment the buckets differ in size, and the p75 of several distributions is not the mean of
  their p75s.
- **Exactly correctable under sampling.** Analytics Engine samples, and every stored row carries
  a `_sample_interval`. `sum(x * _sample_interval)` reconstructs the true total from a sampled
  window, exactly. Nothing about `min` or `max` survives that reconstruction the same way: both
  merge across buckets by construction (the max of several maxes is the true max), but neither is
  sample-correctable - if the sampler happens to drop the one row holding the true extreme, no
  `_sample_interval` weighting recovers it, and the query silently returns the extreme of
  whatever survived. That is the same failure mode that keeps distinct-counts out of this seam
  (see [What analytics cannot do](#what-analytics-cannot-do) below), and admitting `min`/`max` despite it
  would be inconsistent with excluding those.

### There is no `count` aggregate: declare a count measure and sum it

An earlier version of this package also accepted `"count"`, meaning "the number of stored rows"
rather than a sum of any measure. That number is not portable: relationally it was `COUNT(*)`,
and in memory it was one increment per recorded array entry - not the same number on identical
writes (a relational upsert accumulates repeated writes into one row; an in-memory record pushes
a new one), and it does not survive a rollup on **either** backend, because folding rows into a
day bucket collapses the very thing a row count was measuring. Summing eight `sum`s across a
rollup boundary reproduces the pre-rollup total exactly; summing eight `count`s does not, because
after the fold there are fewer, larger rows to count. `count` was removed rather than special-cased,
for the same reason `min`/`max` were never admitted: an aggregate in this seam has to be correct
after a rollup and identical across every backend, not merely plausible on the one you tested
against.

The portable replacement is the pattern `apps/lore`'s own `sigil_views` dataset already uses:
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

Two patterns cover what the other missing aggregates would have given you, and both stay
caller-side and obvious rather than needing a merge-rule enforcement layer inside the package:

- **A mean**: declare a `sum` measure and a count-as-sum measure (see above), and divide them
  yourself once the query returns.
- **A percentile**: see [The histogram pattern](#the-histogram-pattern) below.

### What analytics cannot do

A dataset cannot answer "how many _distinct_ visitors" - a distinct count cannot survive
sampling (a sampled window drops rows, so a naive `COUNT(DISTINCT ...)` under-counts) or a
rollup (once hour buckets fold into a day bucket, which visitor hashes contributed to which hour
is gone). `apps/lore` keeps unique-visitor counts on its own table
(`LoreAnalyticsStore`/`sigil_uniques_daily`) for exactly this reason - see that class's doc for
the full argument. If your app needs distinct counts, they need their own storage; `$analytics`
is not the tool for them.

## The histogram pattern

A percentile does not merge across buckets, but a histogram does - so a percentile is modelled
as an ordinary dimension holding the bucket index, with `count` (or whatever you call the
measure) as the thing you sum. This is exactly how `apps/lore` tracks Web Vitals:

```typescript
import { $analytics } from "alepha/api/analytics";
import { z } from "alepha";

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

```typescript
retention: { hot: "60d", rollup: "day", cold: "400d" }
```

- `hot`: how long raw, hour-bucketed rows are kept, as a day count (`"60d"`).
- `rollup`: the granularity past the hot window. Only `"day"` exists today.
- `cold`: how long rolled (day-bucketed) rows are kept before deletion, also a day count. Must
  be at least as long as `hot` when both are set - `$analytics()` rejects a shorter `cold` at
  declaration time, because the sweep only ever folds up to the hot cutoff, and a `cold`
  boundary more recent than that would prune hour-precision rows the hot window still promises,
  before they are ever rolled up.

Both passes **collapse rather than delete**: folding hour buckets into a day bucket groups by
every declared dimension exactly as before and sums the measures within each group - no
dimension is dropped or merged away, and no total your UI shows ever changes. Only the
resolution of the time axis does, from hourly to daily. Deletion only ever happens past `cold`,
and only to already-rolled rows.

### `retention.hot` cannot exceed roughly 90 days on Analytics Engine

Cloudflare's own Analytics Engine keeps data for approximately 90 days regardless of what you
declare. A dataset declaring a longer `hot` window is **rejected at registration** on that
backend - the provider throws an `AlephaError` at boot rather than letting a report quietly
come up short months later. The relational and memory backends honour the longer window, so
the same declaration is only portable when `retention.hot` stays at 90 days or under.

### Declaring `retention` does nothing on its own

This is the sharpest edge in the whole primitive, worth stating plainly: **nothing in
`alepha/api/analytics` enforces `retention` automatically.** Registering `$analytics()` datasets -
importing `AlephaApiAnalytics` - wires the provider and lets you `record()`/`query()`, full stop.
The hourly sweep that actually folds and prunes rows lives in a **separate module**,
`AlephaApiAnalyticsRollup`, which your app has to import explicitly alongside `AlephaApiAnalytics`:

```typescript
import {
  AlephaApiAnalytics,
  AlephaApiAnalyticsRollup,
} from "alepha/api/analytics";
import { Alepha } from "alepha";

const alepha = Alepha.create()
  .with(AlephaApiAnalytics)
  .with(AlephaApiAnalyticsRollup);
```

Forgetting `AlephaApiAnalyticsRollup` is silent in the sense that nothing throws: `record()` and
`query()` keep working normally, and the raw table simply grows forever. It is not _completely_
silent, though - a boot-time `log.warn` from the retention guard names every dataset that
declares `retention.hot` while no rollup job was ever constructed, specifically so this mistake
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

| Environment                              | Provider                  | Behavior                                     |
| ---------------------------------------- | ------------------------- | -------------------------------------------- |
| Tests (`alepha.isTest()`)                | `MemoryAnalyticsProvider` | In-memory, exact, no sampling                |
| Node / Bun, no Cloudflare binding        | `OrmAnalyticsProvider`    | Relational tables, exact, no sampling        |
| Cloudflare Worker with a dataset binding | `WaeAnalyticsProvider`    | Workers Analytics Engine, samples under load |

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

## Registering the module

A real example, from `apps/lore`:

```typescript
import { AlephaApiAnalyticsRollup } from "alepha/api/analytics";
import { $module } from "alepha";
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
`apps/lore/src/api/entities/loreAnalytics.ts`:

```typescript
import { $analytics } from "alepha/api/analytics";
import { z } from "alepha";
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
