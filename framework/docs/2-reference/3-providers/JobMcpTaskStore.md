# JobMcpTaskStore

## Import

```typescript
import { JobMcpTaskStore } from "alepha/api/jobs";
```

## Overview

The `$job`-backed `McpTaskStore`: an MCP task is a run of the `system.mcp.task`
job, and its id is the execution's uuid.

- **Durable before it is returned**: `create` pushes the run, whose row is
  written before the id comes back.
- **Kept until its ttl**: the row carries `expiresAt = createdAt + ttlMs`,
  the retention floor no success, failure, cancel or trim deletes it
  before, and the job keeps its result (`keepResult`).
- **Input**: a tool that elicits parks the run on a `step.input` named
  `input.e<round>`, one round per question; `answer` writes the answers
  and wakes it, and the tool replays from the top with every answer so
  far. Past the ttl unanswered, the run fails.
- **No retry** (`retries: 0`): a tool call is not replayed behind its
  caller's back after it failed.

Opt-in, bound by the app (with `AlephaApiJobs` and `AlephaMcp`):

```ts
alepha.with({ provide: McpTaskStore, use: JobMcpTaskStore });
```
