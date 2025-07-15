# Alepha Queue

A simple, powerful interface for message queueing systems.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/queue
```
## Module

Provides asynchronous message queuing and processing capabilities through declarative queue descriptors.

The queue module enables reliable background job processing and message passing using the `$queue` descriptor
on class properties. It supports schema validation, automatic retries, and multiple queue backends for
building scalable, decoupled applications with robust error handling.

**Key Features:**
- Declarative queue definition with `$queue` descriptor
- Schema validation for message payloads and headers
- Built-in message handlers with automatic processing
- Multiple queue backends (memory, Redis, etc.)
- Type-safe message publishing and consumption
- Automatic retry mechanisms and error handling

**Basic Usage:**
```ts
import { Alepha, run, t } from "alepha";
import { AlephaQueue, $queue } from "alepha/queue";

class EmailService {
  sendEmail = $queue({
    name: "emails",
    schema: {
      payload: t.object({
        to: t.string(),
        subject: t.string(),
        body: t.string(),
      }),
    },
    handler: async ({ payload }) => {
      // Process the email
      await sendEmailViaProvider(payload.to, payload.subject, payload.body);
      console.log(`Email sent to ${payload.to}`);
    },
  });
}

const alepha = Alepha.create()
  .with(AlephaQueue)
  .with(EmailService);

run(alepha);
```

**Queue Operations:**
```ts
class NotificationService {
  notifications = $queue({
    name: "notifications",
    provider: "memory",
    schema: {
      payload: t.object({
        userId: t.string(),
        message: t.string(),
        type: t.union([t.literal("info"), t.literal("warning"), t.literal("error")]),
      }),
    },
    handler: async ({ payload }) => {
      await sendNotification(payload.userId, payload.message, payload.type);
    },
  });

  async notifyUser(userId: string, message: string, type: "info" | "warning" | "error") {
    // Push message to queue
    await this.notifications.push({ userId, message, type });
  }
}
```

**Batch Processing:**
```ts
class BatchProcessor {
  processTasks = $queue({
    name: "batch-tasks",
    schema: {
      payload: t.object({
        taskId: t.string(),
        data: t.any(),
      }),
    },
    handler: async ({ payload }) => {
      await processTask(payload.taskId, payload.data);
    },
  });

  async submitBatch(tasks: Array<{ taskId: string; data: any }>) {
    // Push multiple messages at once
    await this.processTasks.push(...tasks);
  }
}
```

## API Reference

### Descriptors

#### $consumer()

Consumer descriptor.

#### $queue()

Create a new queue.
