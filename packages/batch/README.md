# Alepha Batch

Efficiently process operations in groups by size or time.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/batch
```
## Module

This module allows you to group multiple asynchronous operations into a single "batch," which is then processed together.
This is an essential pattern for improving performance, reducing I/O, and interacting efficiently with rate-limited APIs or databases.

### Basic Example: A Simple Event Logger

Let's create a batch processor that collects log messages and prints them to the console every 5 seconds or whenever 10 messages have been collected.

```ts
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
```

## API Reference

### Descriptors

#### $batch()

Creates a batch processor. This is useful for grouping multiple operations
(like API calls or database writes) into a single one to improve performance.

### Providers

#### BatchDescriptorProvider

Process every $batch.
