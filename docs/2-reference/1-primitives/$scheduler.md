# $scheduler

## Import

```typescript
import { $scheduler } from "alepha/scheduler";
```

## Overview

Scheduler primitive.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `handler` | `Object` | Yes | Function to run on schedule. |
| `name` | `string` | No | Name of the scheduler |
| `description` | `string` | No | Optional description of the scheduler. |
| `cron` | `string` | No | Cron expression or interval to run the scheduler. |
| `interval` | `DurationLike` | No | Cron expression or interval to run the scheduler. |
| `lock` | `boolean` | No | If true, the scheduler will be locked and only one instance will run at a time |

