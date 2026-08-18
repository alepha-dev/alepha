# $sequence

## Import

```typescript
import { $sequence } from "alepha/orm";
```

## Overview

Declare a portable, scoped numeric sequence.

Works identically on Postgres, SQLite, and Cloudflare D1 — backed by the
shared `alepha_sequences` table managed by `SequenceProvider`.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | No | Sequence name |
| `startWith` | `number` | No | Starting value used on the very first `.next()` for a `(name, scope)` pair |
| `incrementBy` | `number` | No | Amount added on every call to `.next()` |

## Examples

```ts
class Quests {
  // Sequence name defaults to the property key — here "shortId".
  shortId = $sequence();

  async create(campaignId: number, data: ...) {
    // Global counter — same primitive, one shared "default" scope.
    const n = await this.shortId.next();

    // Scoped counter — one independent sequence per campaign.
    const perCampaign = await this.shortId.next(String(campaignId));
  }
}
```

