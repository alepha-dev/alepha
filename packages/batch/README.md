# `alepha/batch`

A powerful batch processing utility for the Alepha framework. This module allows you to group multiple asynchronous operations into a single "batch," which is then processed together. This is an essential pattern for improving performance, reducing I/O, and interacting efficiently with rate-limited APIs or databases.

## Why Use `alepha/batch`?

Imagine you need to log analytics events. Instead of sending an HTTP request for every single event, you can use `$batch` to collect events and send them in a single, optimized network request.

-   **Performance:** Drastically reduce the number of database queries, network requests, or file system writes.
-   **Efficiency:** Interact with APIs that support or require bulk operations.
-   **Resilience:** Built-in retry mechanism for handling transient failures in your batch handlers.
-   **Control:** Batches are flushed automatically based on size, time, or can be flushed manually.
-   **Flexibility:** Use partitions to create separate, independent batches within the same processor.

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
  // Define the batch processor
  logBatch = $batch({
    schema: t.string(),
    maxSize: 10,
    maxDuration: [5, "seconds"],
    handler: async (items) => {
      console.log(`[BATCH LOG] Processing ${items.length} events:`, items);
    },
  });

  // Example of how to use it
  onReady = $hook({
    name: "ready",
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
import {$batch} from "alepha/batch";
import {t} from "alepha";

class UserActivityService {
  // this batcher will create a separate batch for each userId.
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
      // await this.db.users.update({
      //   where: { id: { eq: userId } },
      // }, {
      //   views: { increment: totalViews }
      // });
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

_This example doesn't work in a distributed environment, but it demonstrates how to use partitions effectively._

## API Reference (`$batch`)

### Options

When creating a descriptor with `$batch(options)`, you can provide the following options:

-   `schema: TSchema`: **(Required)** A TypeBox schema to validate each item pushed to the batch.
-   `handler: (items: TItem[]) => Promise<void>`: **(Required)** The asynchronous function that processes an array of items.
-   `maxSize?: number`: The maximum number of items per batch. Once reached, the batch is flushed. **Default:** `10`.
-   `maxDuration?: DurationLike`: The maximum time to wait before flushing a non-full batch (e.g., `[5, "seconds"]`). The timer starts when the first item is added to a partition. **Default:** `[1, "second"]`.
-   `partitionBy?: (item: TItem) => string`: A function that returns a string key for an item. All items with the same key are batched together. If omitted, all items go into a single default batch.
-   `concurrency?: number`: The maximum number of handlers that can run in parallel. Useful for I/O-bound handlers with multiple partitions. **Default:** `1`.
-   `retry?: RetryOptions`: Resilience options for the `handler`, leveraging `@alepha/retry`. Supports `max`, `delay`, `when`, and `onError`.

### Returned API

The `$batch` descriptor is replaced at runtime with an object containing the following methods:

-   `push(item: TItem): Promise<void>`: Adds an item to the appropriate batch. It returns a `Promise` that resolves when the batch containing the item has been successfully processed, or rejects if processing fails after all retries. This provides back-pressure and allows you to `await` the result.
-   `flush(partitionKey?: string): Promise<void>`: Manually triggers a flush.
	-   If `partitionKey` is provided, it flushes only that specific partition.
	-   If `partitionKey` is omitted, it flushes all pending partitions. This is called automatically on application shutdown.
