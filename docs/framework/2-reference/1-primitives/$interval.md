# $interval

## Import

```typescript
import { $interval } from "alepha/datetime";
```

## Overview

Run a function periodically.
It uses the `setInterval` internally.
It starts by default when the context starts and stops when the context stops.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `handler` | `Object` | Yes | The interval handler. |
| `duration` | `DurationLike` | Yes | The interval duration. |

