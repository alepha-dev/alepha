# $eventLog

## Import

```typescript
import { $eventLog } from "alepha/api/analytics";
```

## Overview

Declares an event log: one stored row per event, kept for a bounded time,
queried with exact distinct counts under any combination of filters.

A dataset (`$analytics`) folds events into a sum per bucket as they are
recorded, which is cheap to keep forever but cannot say how many
_different_ visitors, sessions or devices a bucket saw. An event log keeps
the events themselves, so it can, for as long as `keep` says.

Append only: a later fact about an event (an engagement after a view) is
a row of its own. Every backend that holds an event log is exact, so a
result always reports `estimated: false`.

## Options

| Option   | Type      | Required | Description                                                          |
| -------- | --------- | -------- | -------------------------------------------------------------------- |
| `name`   | `string`  | No       | Storage-facing name, snake_case                                      |
| `index`  | `string`  | Yes      | The column nearly every query filters on, such as an app or a tenant |
| `schema` | `ZObject` | Yes      | The columns of a row: strings, numbers and booleans                  |
| `keep`   | `string`  | Yes      | How long a row is kept: `<n>h` or `<n>d`, such as `"90d"`            |

## Examples

```ts
class Traffic {
  pageviews = $eventLog({
    name: "pageviews",
    index: "appId",
    schema: z.object({
      appId: z.text(),
      sessionId: z.text(),
      path: z.text(),
      country: z.text(),
      views: z.integer(),
    }),
    keep: "90d",
  });

  async onView(
    appId: string,
    sessionId: string,
    path: string,
    country: string,
  ) {
    await this.pageviews.append([
      { appId, sessionId, path, country, views: 1 },
    ]);
  }

  async topPages(appId: string) {
    return this.pageviews.query({
      since: "2026-11-01",
      where: { appId },
      groupBy: ["path"],
      select: {
        views: { sum: "views" },
        visitors: { distinct: "sessionId" },
      },
      orderBy: { key: "visitors", direction: "desc" },
      limit: 20,
    });
  }
}
```
