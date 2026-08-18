# $lock

## Import

```typescript
import { $lock } from "alepha/lock";
```

## Overview

Distributed lock middleware for `use` arrays in `$action`, `$job`, `$page`, `$pipeline`.

Acquires a distributed lock before the handler runs and releases it after completion.
Throws `LockAcquireError` if the lock cannot be acquired — with `wait: true`
it polls first, but still throws when the wait times out.

```ts
processOrder = $action({
  use: [$lock({ name: "process-order" })],
  handler: async ({ body }) => { ... },
});
```

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string \| ((...args: any[]) =&gt; string)` | Yes | Lock key name |
| `wait` | `boolean` | No | Whether to wait for the lock to become available. |
| `maxDuration` | `DurationLike` | No | Maximum duration the lock can be held before automatic expiration. |

