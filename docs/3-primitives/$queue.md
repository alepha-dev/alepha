# $queue

> Creates a queue primitive for asynchronous message processing with background workers.

## Import

```typescript
import { $queue } from "alepha/queue";
```

## Overview

Creates a queue primitive for asynchronous message processing with background workers.

The $queue primitive enables powerful asynchronous communication patterns in your application.
It provides type-safe message queuing with automatic worker processing, making it perfect for
decoupling components and handling background tasks efficiently.

**Background Processing**
- Automatic worker threads for non-blocking message processing
- Built-in retry mechanisms and error handling
- Dead letter queues for failed message handling
- Graceful shutdown and worker lifecycle management

**Type Safety**
- Full TypeScript support with schema validation using TypeBox
- Type-safe message payloads with automatic inference
- Runtime validation of all queued messages
- Compile-time errors for invalid message structures

**Storage Flexibility**
- Memory provider for development and testing
- Redis provider for production scalability and persistence
- Custom provider support for specialized backends
- Automatic failover and connection pooling

**Performance & Scalability**
- Batch processing support for high-throughput scenarios
- Horizontal scaling with distributed queue backends
- Configurable concurrency and worker pools
- Efficient serialization and message routing

**Reliability**
- Message persistence across application restarts
- Automatic retry with exponential backoff
- Dead letter handling for permanently failed messages
- Comprehensive logging and monitoring integration

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | No | Unique name for the queue |
| `description` | `string` | No | Human-readable description of the queue's purpose |
| `provider` | `"memory" \| Service&lt;QueueProvider&gt;` | No | Queue storage provider configuration |
| `schema` | `T` | Yes | TypeBox schema defining the structure of messages in this queue |
| `handler` | `Object` | No | Message handler function that processes queue messages |

## Examples

Basic notification queue
```typescript
const emailQueue = $queue({
  name: "email-notifications",
  schema: t.object({
    to: t.text(),
    subject: t.text(),
    body: t.text(),
    priority: t.optional(t.enum(["high", "normal"]))
  }),
  handler: async (message) => {
    await emailService.send(message.payload);
    console.log(`Email sent to ${message.payload.to}`);
  }
});

// Push messages for background processing
await emailQueue.push({
  to: "user@example.com",
  subject: "Welcome!",
  body: "Welcome to our platform",
  priority: "high"
});
```

Batch processing with Redis
```typescript
const imageQueue = $queue({
  name: "image-processing",
  provider: RedisQueueProvider,
  schema: t.object({
    imageId: t.text(),
    operations: t.array(t.enum(["resize", "compress", "thumbnail"]))
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
  schema: t.object({
    taskType: t.enum(["cleanup", "backup", "report"]),
    data: t.record(t.text(), t.any())
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

