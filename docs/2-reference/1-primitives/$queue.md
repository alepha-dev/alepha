# $queue

## Import

```typescript
import { $queue } from "alepha/queue";
```

## Overview

Creates a queue primitive for asynchronous message processing with background workers.

`$queue` is the **raw transport layer**: it fans messages out to background
workers over the configured backend with type-safe payloads. Delivery is
**at-most-once** — a message is popped from the backend before the handler
runs, so a handler error or a process crash loses it. There is no retry,
no dead-letter queue, and no delivery guarantee at this layer.

**For work that must not be lost, use `$job` (alepha/api/jobs) instead.**
It layers a durable, DB-backed outbox over this transport: at-least-once
delivery, retries, idempotency keys, priorities, crash recovery via a
reconciliation sweep, and failure records.

**What $queue gives you**
- Type-safe payloads with schema validation at push and receive
- Background workers with graceful shutdown and lifecycle management
- Pluggable backends: memory (dev/test), Redis, Cloudflare Queues
- Cheap fire-and-forget fan-out where occasional loss is acceptable
  (cache invalidation, presence pings, metrics, live notifications)

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | No | Unique name for the queue |
| `description` | `string` | No | Human-readable description of the queue's purpose |
| `provider` | `"memory" \| Service&lt;QueueProvider&gt;` | No | Queue storage provider configuration |
| `schema` | `T` | Yes | Zod schema defining the structure of messages in this queue |
| `handler` | `Object` | No | Message handler function that processes queue messages |

## Examples

Loss-tolerant event fan-out
```typescript
const activityQueue = $queue({
  name: "activity-events",
  schema: z.object({
    userId: z.text(),
    event: z.text(),
    at: z.number()
  }),
  handler: async (message) => {
    await metrics.track(message.payload);
  }
});

// Push messages for background processing
await activityQueue.push({
  userId: "u1",
  event: "page-view",
  at: 1700000000000
});
```

Batch processing with Redis
```typescript
const imageQueue = $queue({
  name: "image-processing",
  provider: RedisQueueProvider,
  schema: z.object({
    imageId: z.text(),
    operations: z.array(z.enum(["resize", "compress", "thumbnail"]))
  }),
  handler: async (message) => {
    for (const op of message.payload.operations) {
      await processImage(message.payload.imageId, op);
    }
  }
});

// Batch processing multiple images
await imageQueue.push(
  { imageId: "img1", operations: ["resize", "thumbnail"] },
  { imageId: "img2", operations: ["compress"] },
  { imageId: "img3", operations: ["resize", "compress", "thumbnail"] }
);
```

Development with memory provider
```typescript
const taskQueue = $queue({
  name: "dev-tasks",
  provider: "memory",
  schema: z.object({
    taskType: z.enum(["cleanup", "backup", "report"]),
    data: z.record(z.text(), z.any())
  }),
  handler: async (message) => {
    switch (message.payload.taskType) {
      case "cleanup":
        await performCleanup(message.payload.data);
        break;
      case "backup":
        await createBackup(message.payload.data);
        break;
      case "report":
        await generateReport(message.payload.data);
        break;
    }
  }
});
```

