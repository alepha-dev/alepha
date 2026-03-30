# $job

## Import

```typescript
import { $job } from "alepha/api/jobs";
```

## Overview

Job primitive for defining scheduled and on-demand tasks with payload validation, retry policies, and batching.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `schema` | `T` | No | Payload schema (TypeBox) |
| `cron` | `string` | No | Cron expression for automatic scheduling. |
| `lock` | `boolean` | No | Whether to use a distributed lock for cron execution. |
| `retry` | `JobRetryOptions` | No | Retry policy for failed executions. |
| `timeout` | `DurationLike` | No | Max execution time per attempt. |
| `concurrency` | `number` | No | Max parallel executions. |
| `batch` | `JobBatchOptions` | No | Consumer batching configuration. |
| `priority` | `JobPriority` | No | Default priority for pushed jobs. |
| `handler` | `Object` | Yes | Handler function for job execution. |

