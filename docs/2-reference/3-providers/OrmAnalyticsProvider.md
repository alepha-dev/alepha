# OrmAnalyticsProvider

## Import

```typescript
import { OrmAnalyticsProvider } from "alepha/api/analytics";
```

## Overview

Two relational tables per dataset: raw hour buckets and rolled day buckets.

The default on every Node and Postgres deployment, and the cold tier of the
Analytics Engine provider. Numbers here are **exact** - nothing samples, so
`estimated` is always `false`.

Rows are stored raw in the sense that no dimension is ever dropped, but a
write still upserts on `(time_bucket, …dimensions)` with `count + excluded.count`.
That is free: batches arrive pre-folded and nothing reads finer than an hour,
so a page hit five hundred times in an hour is one row rather than five
hundred.

## Registration is eager, not lazy

Call `register` once per dataset, **before** `alepha.start()` - the
same rule every `$entity`/`$repository` in the framework already lives
under (`Repository`'s constructor calls `DatabaseProvider.registerEntity`
unconditionally, with no lazy path). `entities()` is then a plain lookup;
a dataset that was never registered throws `AlephaError` at first use
rather than trying to invent a table at request time. Task 7's `$analytics()`
primitive is expected to call `register()` for every declared dataset at
construction, which - like every other primitive's `$inject`/`$repository`
field - runs before the app starts.

## Dimension and measure names are never trusted as SQL identifiers

`dataset.dimensions`/`dataset.measures` are developer-declared, source-code
constants - the same trust level as an `$entity` schema, which this
provider inherits without extra checks. `AnalyticsQuery.where` / `groupBy`
/ `select`, by contrast, are the shape an HTTP endpoint is most likely to
forward client-supplied keys into unmodified. Every name drawn from a query
(rather than from the dataset descriptor itself) is checked against the
dataset's declared dimensions/measures - via `assertKnownDimension`
/ `assertKnownMeasure` - before it is ever spliced into SQL text with
`sql.raw`. An unknown name throws `AlephaError` instead of reaching the
database as an attacker-chosen identifier.
