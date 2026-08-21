# SqlExpressionProvider

## Import

```typescript
import { SqlExpressionProvider } from "alepha/orm";
```

## Overview

Dialect-neutral SQL expression builder.

Postgres stores timestamps as real timestamps; SQLite (and therefore
Cloudflare D1) stores them as epoch-millisecond integers. Every date
expression has to branch on that, which is why applications end up
hand-writing the same aggregation twice. These helpers emit the correct
fragment for the active dialect so the expression is written once.

```ts
class StatsController {
  protected readonly sqlx = $inject(SqlExpressionProvider);
  protected readonly database = $inject(DatabaseProvider);
  protected readonly quests = $repository(quests);

  perDay = () =>
    this.database.run(
      sql`SELECT ${this.sqlx.dateDay(this.quests.table.createdAt)} AS day,
               COUNT(*) AS total
        FROM ${this.quests.table} GROUP BY 1`,
      z.object({ day: z.text(), total: z.integer() }),
    );
}
```
