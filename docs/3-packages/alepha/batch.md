# Alepha - Batch

## Installation

```bash
npm install alepha
```

## Overview

This module allows you to group multiple asynchronous operations into a single "batch," which is then processed together.
This is an essential pattern for improving performance, reducing I/O, and interacting efficiently with rate-limited APIs or databases.

```ts
import { Alepha, $hook, run, t } from "alepha";
import { $batch } from "alepha/batch";

class LoggingService {
  // define the batch processor
  logBatch = $batch({
    schema: t.text(),
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
      // push() returns an ID immediately
      const id1 = await this.logBatch.push("Application started.");
      const id2 = await this.logBatch.push("User authenticated.");

      // optionally wait for processing to complete
      await this.logBatch.wait(id1);

      // or check the status
      const status = this.logBatch.status(id2);
      console.log(status?.status); // "pending" | "processing" | "completed" | "failed"
    },
  });
}
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $batch()

Creates a batch processing descriptor for efficient grouping and processing of multiple operations.
