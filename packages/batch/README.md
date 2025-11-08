# Alepha Batch

Efficiently process operations in groups by size or time.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

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
      this.logBatch.push("Application started.");
      this.logBatch.push("User authenticated.");
      // ... more events pushed from elsewhere in the app
    },
  });
}
```

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaBatch } from "alepha/batch";

const alepha = Alepha.create()
	.with(AlephaBatch);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $batch()

Creates a batch processing descriptor for efficient grouping and processing of multiple operations.
