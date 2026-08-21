# $job

## Import

```typescript
import { $job } from "alepha/api/jobs";
```

## Overview

Job primitive for defining scheduled (cron) or queued (push) tasks.

A job must be either **cron-only** (pass `cron`) or **queue-only**
(pass `schema`), never both. To run scheduled work that processes
payloads, compose two jobs: a cron that pushes payloads, and a
queue job that handles them.

## Options

| Option        | Type                         | Required | Description                                                                                                                                                      |
| ------------- | ---------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | `string`                     | No       | Optional explicit job name                                                                                                                                       |
| `description` | `string`                     | No       | Human-readable description (shown in the admin UI).                                                                                                              |
| `schema`      | `T`                          | No       | Payload schema (Zod)                                                                                                                                             |
| `cron`        | `string`                     | No       | Cron expression for recurring execution                                                                                                                          |
| `retry`       | `JobRetryOptions`            | No       | Retry policy for queue-mode and direct-mode jobs                                                                                                                 |
| `lock`        | `boolean`                    | No       | **Cron-mode only.** Whether to acquire a distributed lock around the cron tick so that only one instance of a multi-replica deployment runs the handler per tick |
| `timeout`     | `DurationLike`               | No       | Max execution time per attempt                                                                                                                                   |
| `priority`    | `JobPriority`                | No       | Default priority for pushed jobs                                                                                                                                 |
| `record`      | `"error" \| "all" \| "none"` | No       | Whether to record successful executions                                                                                                                          |
| `keep`        | `Object`                     | No       | Override the global ring-buffer trim for this job                                                                                                                |
| `handler`     | `Object`                     | Yes      | Handler function                                                                                                                                                 |
