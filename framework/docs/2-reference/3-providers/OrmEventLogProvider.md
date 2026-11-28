# OrmEventLogProvider

## Import

```typescript
import { OrmEventLogProvider } from "alepha/api/analytics";
```

## Overview

Event logs on a relational database: SQLite, Cloudflare D1 and Postgres.

One table per log, `analytics_<name>_events`, holding the declared
columns and `event_at` (millis), indexed on `(index column, event_at)`,
the shape of nearly every read: one app, one window. No primary key and
no unique index: two identical events are two rows.

**D1's 100 bound parameters.** Two places could exceed it, and neither
binds more than one value per list on SQLite:

- `append` sends the whole batch as one JSON array and inserts from
  `json_each`, so a batch is one statement binding one value, whatever
  its size. On Postgres (65,535 parameters) it is a plain multi-row insert,
  chunked by `Repository.createMany`.
- an `inArray` filter on SQLite reads `IN (SELECT value FROM json_each(?))`,
  one bound value for the whole set; on Postgres it is a plain `IN` list.

**Names.** Every column, grain and selection a query names is validated by
`EventLogPlan.selections` against the declaration before it reaches SQL
text; values are always bound.
