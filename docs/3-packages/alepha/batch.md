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

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/providers).

#### BatchProvider

The batch processing handler function that processes arrays of validated items.
  /
  handler: (items: TItem[]) => TResponse;

  /**
  Maximum number of items to collect before automatically flushing the batch.
  
  @default 10
  /
  maxSize?: number;

  /**
  Maximum number of items that can be queued in a single partition.
  If exceeded, push() will throw an error.
  /
  maxQueueSize?: number;

  /**
  Maximum time to wait before flushing a batch, even if it hasn't reached maxSize.
  
  @default [1, "second"]
  /
  maxDuration?: DurationLike;

  /**
  Function to determine partition keys for grouping items into separate batches.
  /
  partitionBy?: (item: TItem) => string;

  /**
  Maximum number of batch handlers that can execute simultaneously.
  
  @default 1
  /
  concurrency?: number;

  /**
  Retry configuration for failed batch processing operations.
  /
  retry?: {
    /**
    The maximum number of attempts.
    
    @default 3
    /
    max?: number;

    /**
    The backoff strategy for delays between retries.
    Can be a fixed number (in ms) or a configuration object for exponential backoff.
    
    @default { initial: 200, factor: 2, jitter: true }
    /
    backoff?: number | RetryBackoffOptions;

    /**
    An overall time limit for all retry attempts combined.
    
    e.g., `[5, 'seconds']`
    /
    maxDuration?: DurationLike;

    /**
    A function that determines if a retry should be attempted based on the error.
    
    @default (error) => true (retries on any error)
    /
    when?: (error: Error) => boolean;

    /**
    A custom callback for when a retry attempt fails.
    This is called before the delay.
    /
    onError?: (error: Error, attempt: number) => void;
  };
}

// ---------------------------------------------------------------------------------------------------------------------

export type BatchItemStatus = "pending" | "processing" | "completed" | "failed";

export interface BatchItemState<TItem, TResponse> {
  id: string;
  item: TItem;
  partitionKey: string;
  status: BatchItemStatus;
  result?: TResponse;
  error?: Error;
  promise?: Promise<TResponse>;
  resolve?: (value: TResponse) => void;
  reject?: (error: Error) => void;
}

export interface PartitionState {
  itemIds: string[];
  timeout?: { clear: () => void };
  flushing: boolean;
}

/**
Context object that holds all state for a batch processor instance.
/
export interface BatchContext<TItem, TResponse> {
  options: BatchOptions<TItem, TResponse>;
  itemStates: Map<string, BatchItemState<TItem, TResponse>>;
  partitions: Map<string, PartitionState>;
  activeHandlers: PromiseWithResolvers<void>[];
  isShuttingDown: boolean;
  isReady: boolean;
  alepha: Alepha;
}

// ---------------------------------------------------------------------------------------------------------------------

/**
Service for batch processing operations.
Provides methods to manage batches of items with automatic flushing based on size or time.
