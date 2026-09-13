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

| Option        | Type                  | Required | Description                                                                                                                                                      |
| ------------- | --------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | `string`              | Yes      | The job's name: `&lt;domain&gt;.&lt;action&gt;`, lowercase kebab-case segments, such as `estates.sweep-commands` or `quests.send-due-reminders`                  |
| `description` | `string`              | Yes      | What the job does, in one sentence, shown to operators in the admin                                                                                              |
| `schema`      | `T`                   | No       | Payload schema (Zod)                                                                                                                                             |
| `cron`        | `string`              | No       | Cron expression for recurring execution                                                                                                                          |
| `retry`       | `JobRetryOptions`     | No       | Retry policy for queue-mode and direct-mode jobs                                                                                                                 |
| `lock`        | `boolean`             | No       | **Cron-mode only.** Whether to acquire a distributed lock around the cron tick so that only one instance of a multi-replica deployment runs the handler per tick |
| `timeout`     | `DurationLike`        | No       | Max execution time per attempt                                                                                                                                   |
| `inline`      | `boolean`             | No       | Run the handler inline and make the caller wait for it                                                                                                           |
| `retention`   | `JobRetentionOptions` | No       | How long the job's executions are kept, per status                                                                                                               |
| `handler`     | `Object`              | Yes      | Handler function                                                                                                                                                 |
