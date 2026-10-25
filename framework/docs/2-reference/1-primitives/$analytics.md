# $analytics

## Import

```typescript
import { $analytics } from "alepha/api/analytics";
```

## Overview

Declares an analytics dataset: what you record, and what you can ask.

The same declaration runs on a relational database and in memory, and, as
long as every measure folds `sum` only, on Workers Analytics Engine. Which
one is bound is a runtime decision made by the module, so app code never
names a backend. Gauges (`folds: { temperature: ["min", "max", "last"] }`)
need an exact backend and are refused at boot on Analytics Engine, which
samples.

## Options

| Option | Type     | Required | Description                 |
| ------ | -------- | -------- | --------------------------- |
| `name` | `string` | No       | Storage-facing dataset name |

## Examples

```ts
class PageViews {
  views = $analytics({
    index: "app",
    dimensions: z.object({ app: z.text(), path: z.text(), country: z.text() }),
    measures: z.object({ count: z.integer() }),
    // The wire format, append only: a new name goes on the END.
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
