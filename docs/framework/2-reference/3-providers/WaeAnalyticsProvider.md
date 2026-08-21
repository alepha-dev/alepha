# WaeAnalyticsProvider

## Import

```typescript
import { WaeAnalyticsProvider } from "alepha/api/analytics";
```

## Overview

Hot rows on Workers Analytics Engine, rolled rows in a durable store.

A DI-injectable provider, not a plain constructor-options class - this is
the second design of this class. The first took `dataset` / `sql` / `cold`
as constructor options, which made it easy to unit test but impossible for
`index.workerd.ts` to select automatically: `alepha.with({ provide, use })`
constructs `use` via `alepha.inject(use)`, which needs a class DI can build
on its own. Follows `CloudflareEmailProvider` closely - the closest
existing analogue, combining a **write-only Workers binding** with an
**account-scoped REST API** gated by `CLOUDFLARE_ACCOUNT_ID` /
`CLOUDFLARE_ANALYTICS_TOKEN`:

- `$inject(Alepha)` + `$hook({ on: "start" })` reads
  `this.alepha.get("cloudflare.env")` and stores the binding in a
  `protected` field, exactly like `R2FileStorageProvider` and
  `CloudflareEmailProvider`.
- `cold = $inject(OrmAnalyticsProvider)` is the **concrete** class, not
  `$inject(AnalyticsProvider)`. Injecting the abstract seam here would be
  circular the moment `index.workerd.ts`'s `register()` substitutes this
  very class in for that seam - this provider would try to inject itself.
- `AnalyticsEngineSql` is still a plain constructor-options class (nothing
  about it needs DI), just built internally by `sql` rather than
  passed in - the same relationship `CloudflareEmailProvider.sendViaRest`
  has with `fetch`.

Testability does not regress: `alepha.set("cloudflare.env", { NAME: fake })`
before `start()` substitutes the write binding, the same pattern
`CloudflareEmailProvider.spec.ts` uses; a test subclass overriding
`httpFetch` substitutes the read transport, the same pattern
`CloudflareEmailRest.spec.ts` uses for `httpPost`.

## Every number read back is an estimate

Analytics Engine samples, and `_sample_interval` - how many real events each
stored row stands for - varies per row, so a constant multiplier is wrong.
Every measure comes back as `sum(double * _sample_interval)` - the
sample-interval-corrected sum, never a raw stored double - and the result
carries `estimated: true` so a UI cannot present them as measurements by
accident.

## The cold tier cannot be Analytics Engine

Writing aggregates back as new data points would give them a fresh retention
clock, re-sample already-sampled data, and require a discriminator to keep
rolled rows from being counted alongside the raw ones they summarise. So a
Cloudflare deployment needs a relational store for anything older than the
hot window - the same compromise unique visitors already forced on
`WaeAnalyticsStore` in `@alepha/sigil`.

`record()` never writes to `cold` - only to Analytics Engine - so `cold`'s
raw tier starts every dataset's life with zero rows for it. Left alone,
`cold.rollup()` would fold a table nothing ever populated: a structural
no-op, not a race, and it would silently lose every hour past Analytics
Engine's own ~90-day retention, which is exactly what a hot/cold split
exists to prevent. `rollup` closes that gap itself, immediately
before delegating: it tops up `cold`'s raw tier with Analytics Engine rows
older than `before` (hour granularity, matching what `record()` would have
written directly), _then_ calls `cold.rollup()` to fold them - see
`forwardToCold`. What crosses over is the sample-corrected total
`query()` already computed, not a raw stored double, so `cold`'s own
arithmetic (the upsert accumulate, the day fold) can add and fold it
exactly like any other number, the same one-way trip every folded number
already takes when `OrmAnalyticsProvider` moves a row from its own raw
tier to its own rolled tier. That is a statement about arithmetic, not
about epistemics, and the two must not be conflated: the number is safe to
add without re-applying a correction, but it is still, irreducibly, a
number that came from a sample. See "The read side has to merge too"
below for why `estimated` stays `true` regardless of which tier answered a
query.

## `prune()` cannot rely on deletion alone

Analytics Engine has no delete API, so `cold.prune(dataset, before)` alone
cannot make Analytics Engine's own copy of `[..., before)` stop existing -
it only removes `cold`'s copy. Left at that, `AnalyticsProvider.prune`'s
own contract ("deletes every row older than `before`, **on whichever tier
it lives**") would be silently broken on this backend: a query for an
already-pruned window would fall out of `cold` and fall back to Analytics
Engine, which still has it and always will until its own ~90-day
retention eventually, invisibly, ages it out. `prune` therefore also
durably records `before` as a prune floor - via
`OrmAnalyticsProvider.recordPruneFloor`, kept in `cold` because it is the
one piece of this provider's state that already survives a restart - and
`query`/`forwardToCold` both clamp their effective `since` to
it, on every read, regardless of what either tier currently holds. That is
what makes `prune()` mean the same thing here as it does on
`OrmAnalyticsProvider`: once pruned, gone from every result, not merely
from `cold`'s own copy. See `recordPruneFloor`'s own doc for why this is a
dedicated table rather than a row in the dataset's own raw/rolled table,
and `prune`'s own doc for why the floor is written _before_ the
delete, not after.

## The read side has to merge too

Forwarding rows into `cold` is pointless if `query()` never reads them
back - a window older than Analytics Engine's retention would still
silently return nothing, and the worst case is a window straddling the
boundary returning only the Analytics Engine portion with no sign anything
is missing. So `query` queries both sources and merges, the same way
`OrmAnalyticsProvider.query()` already merges its own raw and rolled
tiers - same merge key (`JSON.stringify` of the grouped dimension values),
the same mergeable aggregate (`sum`, added across sources), ordering and
`limit` applied once to the merged set rather than per source. Two things
are specific to a _composite_ of two different backends rather than two
tables in the same one:

- **Skipping `cold` when it cannot matter.** A window entirely within
  `dataset`'s declared hot retention cannot have anything forwarded into
  it yet in a correctly-running system - see `mightNeedCold` - so
  `query()` skips `cold` for that case with zero calls to it, the same
  structural argument that makes `forwardToCold` safe rather than a
  speed hack.
- **Not double-counting an hour Analytics Engine still has after it was
  forwarded.** Analytics Engine has no delete API, so a forwarded hour
  keeps existing on both sides forever. `query()` re-derives the same
  watermark `forwardToCold` uses and narrows the Analytics Engine
  side's `since` to exclude whatever `cold` already covers - see
  `nextBucket` - rather than trusting the two sources to be disjoint.
- **`estimated` is unconditionally `true`.** Not just because Analytics
  Engine samples, but because a row `cold` holds only ever got there
  through `forwardToCold`, which itself read it out of Analytics Engine as
  a sample-corrected estimate. Landing in a relational table does not
  retroactively make it a measurement - so a merge where every
  contributing row came from `cold` is _not_ exact either, and does not
  report `estimated: false`. Nothing this provider can return was ever
  measured directly; only `OrmAnalyticsProvider` running on its own
  (never forwarded through Analytics Engine at all) earns that.

## Writes are free of round-trips

`writeDataPoint()` returns nothing and is not awaited; the runtime writes in
the background. The sequential round-trip cost that dominates a remote
database disappears on this path entirely.
