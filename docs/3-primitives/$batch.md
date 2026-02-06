# $batch

> Creates a batch processing primitive for efficient grouping and processing of multiple operations.

## Import

```typescript
import { $batch } from "alepha/batch";
```

## Overview

Creates a batch processing primitive for efficient grouping and processing of multiple operations.

## Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `schema` | `TItem` | Yes | TypeBox schema for validating each item added to the batch. |
| `handler` | `Object` | Yes | The batch processing handler function that processes arrays of validated items. |
| `maxSize` | `number` | No | Maximum number of items to collect before automatically flushing the batch. |
| `maxQueueSize` | `number` | No | Maximum number of items that can be queued in a single partition |
| `maxDuration` | `DurationLike` | No | Maximum time to wait before flushing a batch, even if it hasn't reached maxSize. |
| `partitionBy` | `Object` | No | Function to determine partition keys for grouping items into separate batches. |
| `concurrency` | `number` | No | Maximum number of batch handlers that can execute simultaneously. |
| `retry` | `Omit&lt;RetryPrimitiveOptions&lt;() =&gt; Array&lt;Static&lt;TItem&gt;&gt;&gt;, "...` | No | Retry configuration for failed batch processing operations. |

