## Alepha Batch

A powerful batch processing utility for the Alepha framework. This module allows you to group multiple asynchronous operations into a single "batch," which is then processed together. This is an essential pattern for improving performance, reducing I/O, and interacting efficiently with rate-limited APIs or databases.

## Installation

This package is part of the Alepha framework and can be installed via npm:

```bash
npm install alepha
```

The module `AlephaBatch` will be automatically registered when you use the `$batch` descriptor in your application.

## Usage

### Basic Example: A Simple Event Logger

Let's create a batch processor that collects log messages and prints them to the console every 5 seconds or whenever 10 messages have been collected.

```typescript
import { Alepha, $hook, run, t } from "alepha";
import { $batch } from "alepha/batch";

class LoggingService {
  // define the batch processor
  logBatch = $batch({
    schema: t.string(),
    maxSize: 10,
    maxDuration: [5, "seconds"],
    handler: async (items) => {
      console.log(`[BATCH LOG] Processing ${items.length} events:`, items);
    },
  });

  // example of how to use it
  onReady = $hook({
    on: "ready",
    handler: async () => {
      this.logBatch.push("Application started.");
      this.logBatch.push("User authenticated.");
      // ... more events pushed from elsewhere in the app
    },
  });
}

run(LoggingService);
```
In this example, the `handler` will be called with `["Application started.", "User authenticated."]` after 5 seconds have passed.

### Advanced Example: Partitioned Batching

Partitioning is the most powerful feature of `$batch`. It allows you to create separate batches for different entities.

Imagine you're updating user view counts in a database. You don't want to update all users at once, but rather batch the updates *per user*. The `partitionBy` option is perfect for this.

```typescript
import { t } from "alepha";
import { $batch } from "alepha/batch";

class UserActivityService {
  // this batcher will create a separate batch for each userId
  userViewCountBatch = $batch({
    schema: t.object({
      userId: t.number(),
      viewCount: t.number(),
    }),
    maxSize: 5, // flush after 5 updates for a single user
    maxDuration: [10, "seconds"],
    partitionBy: (item) => `user-${item.userId}`, // group updates by user ID
    handler: async (items) => {
      const userId = items[0].userId;
      const totalViews = items.reduce((sum, item) => sum + item.viewCount, 0);

      console.log(`[DB] Updating user ${userId} with ${totalViews} new views.`);
    },
    // add resilience to the database operation
    retry: {
      max: 3,
      delay: 500,
    },
  });

  trackView(userId: number) {
    this.userViewCountBatch.push({userId, viewCount: 1});
  }
}
```
**How it works:**
- If you call `trackView(1)` three times and `trackView(2)` two times, two separate partitions will be created: `user-1` and `user-2`.
- Neither batch will be flushed yet because they are below `maxSize`.
- After 10 seconds, both batches will be flushed independently by two separate calls to the `handler`.

_This example doesn't work in a distributed environment, `alepha/batch/redis` will be created for that._
