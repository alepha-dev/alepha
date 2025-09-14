# Alepha Thread

Run worker threads in Node.js with a simple API.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Simple interface for managing worker threads in Alepha.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaThread } from "alepha/thread";

const alepha = Alepha.create()
	.with(AlephaThread);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $thread()

Creates a worker thread descriptor for offloading CPU-intensive tasks to separate threads.

This descriptor enables you to run JavaScript code in Node.js worker threads, allowing you to
leverage multiple CPU cores and avoid blocking the main event loop. It provides a pool-based
approach with intelligent thread reuse and automatic lifecycle management.

**Key Features**

- **Thread Pool Management**: Automatically manages a pool of worker threads with configurable limits
- **Thread Reuse**: Reuses existing threads to avoid expensive initialization overhead
- **Idle Cleanup**: Automatically terminates unused threads after a configurable timeout
- **Type-Safe Communication**: Optional TypeBox schema validation for data passed to threads
- **CPU-Aware Defaults**: Pool size defaults to CPU count × 2 for optimal performance
- **Error Handling**: Proper error propagation and thread cleanup on failures

**Use Cases**

Perfect for CPU-intensive tasks that would otherwise block the main thread:
- Image/video processing
- Data transformation and analysis
- Cryptographic operations
- Heavy computations and algorithms
- Background data processing

**Basic thread usage:**
```ts
import { $thread } from "alepha/thread";

class DataProcessor {
  heavyComputation = $thread({
    name: "compute",
    handler: async () => {
      // This runs in a separate worker thread
      let result = 0;
      for (let i = 0; i < 1000000; i++) {
        result += Math.sqrt(i);
      }
      return { result, timestamp: Date.now() };
    }
  });

  async processData() {
    // Execute in worker thread without blocking main thread
    const result = await this.heavyComputation.execute();
    console.log(`Computation result: ${result.result}`);
  }
}
```

**Configured thread pool with custom settings:**
```ts
class ImageProcessor {
  imageProcessor = $thread({
    name: "image-processing",
    maxPoolSize: 4,        // Limit to 4 concurrent threads
    idleTimeout: 30000,    // Clean up idle threads after 30 seconds
    handler: async () => {
      // CPU-intensive image processing logic
      return await processImageData();
    }
  });
}
```

**Thread with data validation:**
```ts
import { t } from "alepha";

class CryptoService {
  encrypt = $thread({
    name: "encryption",
    handler: async () => {
      // Perform encryption operations
      return await encryptData();
    }
  });

  async encryptSensitiveData(data: { text: string; key: string }) {
    // Validate input data before sending to thread
    const schema = t.object({
      text: t.string(),
      key: t.string()
    });

    return await this.encrypt.execute(data, schema);
  }
}
```

**Parallel processing with multiple threads:**
```ts
class BatchProcessor {
  processor = $thread({
    name: "batch-worker",
    maxPoolSize: 8,  // Allow up to 8 concurrent workers
    handler: async () => {
      return await processBatchItem();
    }
  });

  async processBatch(items: any[]) {
    // Process multiple items in parallel across different threads
    const promises = items.map(() => this.processor.execute());
    const results = await Promise.all(promises);
    return results;
  }
}
```
