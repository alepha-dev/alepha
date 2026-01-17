# Alepha - Batch

## Installation

Part of the `alepha` package. Import from `alepha/batch`.

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

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $batch()

Creates a batch processing primitive for efficient grouping and processing of multiple operations.

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### BatchProvider

Service for batch processing operations.
Provides methods to manage batches of items with automatic flushing based on size or time.
