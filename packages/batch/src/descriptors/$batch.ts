import {
  $hook,
  $inject,
  createDescriptor,
  Descriptor,
  KIND,
  type Static,
  type TSchema,
} from "@alepha/core";
import { DateTimeProvider, type DurationLike } from "@alepha/datetime";
import { $logger } from "@alepha/logger";
import { $retry, type RetryDescriptorOptions } from "@alepha/retry";

/**
 * Creates a batch processing descriptor for efficient grouping and processing of multiple operations.
 *
 * This descriptor provides a powerful batching mechanism that collects multiple individual items
 * and processes them together in groups, significantly improving performance by reducing overhead
 * and enabling bulk operations. It supports partitioning, concurrent processing, automatic flushing,
 * and intelligent retry mechanisms for robust batch processing workflows.
 *
 * **Key Features**
 *
 * - **Intelligent Batching**: Groups items based on size and time thresholds
 * - **Partitioning Support**: Process different types of items in separate batches
 * - **Concurrent Processing**: Handle multiple batches simultaneously with configurable limits
 * - **Automatic Flushing**: Time-based and size-based automatic batch execution
 * - **Type Safety**: Full TypeScript support with schema validation using TypeBox
 * - **Retry Logic**: Built-in retry mechanisms for failed batch operations
 * - **Resource Management**: Automatic cleanup and graceful shutdown handling
 *
 * **Use Cases**
 *
 * Perfect for optimizing high-throughput operations:
 * - Database bulk inserts and updates
 * - API call batching and rate limit optimization
 * - Log aggregation and bulk shipping
 * - File processing and bulk uploads
 * - Event processing and analytics ingestion
 * - Notification delivery optimization
 * - Cache invalidation batching
 *
 * @example
 * **Basic database batch operations:**
 * ```ts
 * import { $batch } from "alepha/batch";
 * import { t } from "alepha";
 *
 * class UserService {
 *   userBatch = $batch({
 *     schema: t.object({
 *       id: t.text(),
 *       name: t.text(),
 *       email: t.text(),
 *       createdAt: t.optional(t.text())
 *     }),
 *     maxSize: 50,          // Process up to 50 users at once
 *     maxDuration: [5, "seconds"],  // Or flush every 5 seconds
 *     handler: async (users) => {
 *       // Bulk insert users - much faster than individual inserts
 *       console.log(`Processing batch of ${users.length} users`);
 *
 *       const result = await this.database.users.insertMany(users.map(user => ({
 *         ...user,
 *         createdAt: user.createdAt || new Date().toISOString()
 *       })));
 *
 *       console.log(`Successfully inserted ${result.length} users`);
 *       return { inserted: result.length, userIds: result.map(r => r.id) };
 *     }
 *   });
 *
 *   async createUser(userData: { name: string; email: string }) {
 *     // Individual calls are automatically batched
 *     const result = await this.userBatch.push({
 *       id: generateId(),
 *       name: userData.name,
 *       email: userData.email
 *     });
 *
 *     return result; // Returns the batch result once batch is processed
 *   }
 * }
 * ```
 *
 * @example
 * **API call batching with partitioning:**
 * ```ts
 * class NotificationService {
 *   notificationBatch = $batch({
 *     schema: t.object({
 *       userId: t.text(),
 *       type: t.enum(["email", "sms", "push"]),
 *       message: t.text(),
 *       priority: t.enum(["high", "normal", "low"])
 *     }),
 *     maxSize: 100,
 *     maxDuration: [10, "seconds"],
 *     // Partition by notification type for different processing
 *     partitionBy: (notification) => notification.type,
 *     concurrency: 3,  // Process up to 3 different types simultaneously
 *     handler: async (notifications) => {
 *       const type = notifications[0].type; // All items in batch have same type
 *       console.log(`Processing ${notifications.length} ${type} notifications`);
 *
 *       switch (type) {
 *         case 'email':
 *           return await this.emailProvider.sendBulk(notifications.map(n => ({
 *             to: n.userId,
 *             subject: 'Notification',
 *             body: n.message,
 *             priority: n.priority
 *           })));
 *
 *         case 'sms':
 *           return await this.smsProvider.sendBulk(notifications.map(n => ({
 *             to: n.userId,
 *             message: n.message
 *           })));
 *
 *         case 'push':
 *           return await this.pushProvider.sendBulk(notifications.map(n => ({
 *             userId: n.userId,
 *             title: 'Notification',
 *             body: n.message,
 *             priority: n.priority
 *           })));
 *       }
 *     }
 *   });
 *
 *   async sendNotification(userId: string, type: 'email' | 'sms' | 'push', message: string, priority: 'high' | 'normal' | 'low' = 'normal') {
 *     // Notifications are automatically batched by type
 *     return await this.notificationBatch.push({
 *       userId,
 *       type,
 *       message,
 *       priority
 *     });
 *   }
 * }
 * ```
 *
 * @example
 * **Log aggregation with retry logic:**
 * ```ts
 * class LoggingService {
 *   logBatch = $batch({
 *     schema: t.object({
 *       timestamp: t.number(),
 *       level: t.enum(["info", "warn", "error"]),
 *       message: t.text(),
 *       metadata: t.optional(t.record(t.text(), t.any())),
 *       source: t.text()
 *     }),
 *     maxSize: 1000,       // Large batches for log efficiency
 *     maxDuration: [30, "seconds"],  // Longer duration for log aggregation
 *     concurrency: 2,      // Limit concurrent log shipments
 *     retry: {
 *       maxAttempts: 5,
 *       delay: [2, "seconds"],
 *       backoff: "exponential"
 *     },
 *     handler: async (logEntries) => {
 *       console.log(`Shipping ${logEntries.length} log entries`);
 *
 *       try {
 *         // Ship logs to external service (e.g., Elasticsearch, Splunk)
 *         const response = await this.logShipper.bulkIndex({
 *           index: 'application-logs',
 *           body: logEntries.map(entry => ([
 *             { index: { _index: 'application-logs' } },
 *             {
 *               ...entry,
 *               '@timestamp': new Date(entry.timestamp).toISOString()
 *             }
 *           ])).flat()
 *         });
 *
 *         if (response.errors) {
 *           console.error(`Some log entries failed to index`, response.errors);
 *           // Retry will be triggered by throwing
 *           throw new Error(`Failed to index ${response.errors.length} log entries`);
 *         }
 *
 *         console.log(`Successfully shipped ${logEntries.length} log entries`);
 *         return { shipped: logEntries.length, indexedAt: Date.now() };
 *
 *       } catch (error) {
 *         console.error(`Failed to ship logs batch`, error);
 *         throw error; // Trigger retry mechanism
 *       }
 *     }
 *   });
 *
 *   async log(level: 'info' | 'warn' | 'error', message: string, metadata?: Record<string, any>, source: string = 'application') {
 *     // Individual log calls are batched and shipped efficiently
 *     return await this.logBatch.push({
 *       timestamp: Date.now(),
 *       level,
 *       message,
 *       metadata,
 *       source
 *     });
 *   }
 * }
 * ```
 *
 * @example
 * **File processing with dynamic partitioning:**
 * ```ts
 * class FileProcessingService {
 *   fileProcessingBatch = $batch({
 *     schema: t.object({
 *       filePath: t.text(),
 *       fileType: t.enum(["image", "video", "document"]),
 *       processingOptions: t.object({
 *         quality: t.optional(t.enum(["low", "medium", "high"])),
 *         format: t.optional(t.text()),
 *         compress: t.optional(t.boolean())
 *       }),
 *       priority: t.enum(["urgent", "normal", "background"])
 *     }),
 *     maxSize: 20,         // Smaller batches for file processing
 *     maxDuration: [2, "minutes"],  // Reasonable time for file accumulation
 *     // Partition by file type and priority for optimal resource usage
 *     partitionBy: (file) => `${file.fileType}-${file.priority}`,
 *     concurrency: 4,      // Multiple concurrent processing pipelines
 *     retry: {
 *       maxAttempts: 3,
 *       delay: [5, "seconds"]
 *     },
 *     handler: async (files) => {
 *       const fileType = files[0].fileType;
 *       const priority = files[0].priority;
 *
 *       console.log(`Processing ${files.length} ${fileType} files with ${priority} priority`);
 *
 *       try {
 *         const results = [];
 *
 *         for (const file of files) {
 *           const result = await this.processFile(file.filePath, file.fileType, file.processingOptions);
 *           results.push({
 *             originalPath: file.filePath,
 *             processedPath: result.outputPath,
 *             size: result.size,
 *             duration: result.processingTime
 *           });
 *         }
 *
 *         // Update database with batch results
 *         await this.updateProcessingStatus(results);
 *
 *         console.log(`Successfully processed ${files.length} ${fileType} files`);
 *         return {
 *           processed: files.length,
 *           fileType,
 *           priority,
 *           totalSize: results.reduce((sum, r) => sum + r.size, 0),
 *           results
 *         };
 *
 *       } catch (error) {
 *         console.error(`Batch file processing failed for ${fileType} files`, error);
 *         throw error;
 *       }
 *     }
 *   });
 *
 *   async processFile(filePath: string, fileType: 'image' | 'video' | 'document', options: any, priority: 'urgent' | 'normal' | 'background' = 'normal') {
 *     // Files are automatically batched by type and priority
 *     return await this.fileProcessingBatch.push({
 *       filePath,
 *       fileType,
 *       processingOptions: options,
 *       priority
 *     });
 *   }
 * }
 * ```
 */
export const $batch = <TItem extends TSchema, TResponse>(
  options: BatchDescriptorOptions<TItem, TResponse>,
): BatchDescriptor<TItem, TResponse> =>
  createDescriptor(BatchDescriptor<TItem, TResponse>, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface BatchDescriptorOptions<
  TItem extends TSchema,
  TResponse = any,
> {
  /**
   * TypeBox schema for validating each item added to the batch.
   *
   * This schema:
   * - Validates every item pushed to the batch for data integrity
   * - Provides full TypeScript type inference for batch items
   * - Ensures type safety between item producers and batch handlers
   * - Enables automatic serialization/deserialization if needed
   *
   * **Schema Design Guidelines**:
   * - Keep schemas focused on the data needed for batch processing
   * - Use optional fields for data that might not always be present
   * - Include identifiers that might be needed for partitioning
   * - Consider versioning for schema evolution in long-running systems
   *
   * @example
   * ```ts
   * t.object({
   *   id: t.text(),
   *   operation: t.enum(["create", "update"]),
   *   data: t.record(t.text(), t.any()),
   *   timestamp: t.optional(t.number()),
   *   priority: t.optional(t.enum(["high", "normal"]))
   * })
   * ```
   */
  schema: TItem;

  /**
   * The batch processing handler function that processes arrays of validated items.
   *
   * This handler:
   * - Receives an array of validated items based on the schema
   * - Should implement bulk operations for maximum efficiency
   * - Can be async and perform any operations (database, API calls, etc.)
   * - Should handle errors appropriately (retry logic is provided separately)
   * - Has access to the full Alepha dependency injection container
   * - Returns results that will be provided to all items in the batch
   *
   * **Handler Design Guidelines**:
   * - Implement true bulk operations rather than loops of individual operations
   * - Use transactions when processing related data for consistency
   * - Log batch processing progress and results for monitoring
   * - Handle partial failures gracefully when possible
   * - Consider memory usage for large batch sizes
   *
   * **Performance Considerations**:
   * - Batch operations should be significantly faster than individual operations
   * - Use database bulk operations (INSERT, UPDATE, etc.) when available
   * - Optimize for the expected batch size and data characteristics
   * - Consider connection pooling and resource limits
   *
   * @param items - Array of validated items to process in this batch
   * @returns Result that will be returned to all callers who contributed items to this batch
   *
   * @example
   * ```ts
   * handler: async (items) => {
   *   console.log(`Processing batch of ${items.length} items`);
   *
   *   try {
   *     // Use bulk operations for maximum efficiency
   *     const results = await this.database.transaction(async (tx) => {
   *       const insertResults = await tx.items.insertMany(items);
   *
   *       // Update related data in bulk
   *       const updates = items.map(item => ({ id: item.id, processed: true }));
   *       await tx.items.updateMany(updates);
   *
   *       return insertResults;
   *     });
   *
   *     // Log successful processing
   *     console.log(`Successfully processed ${items.length} items`);
   *
   *     return {
   *       processed: items.length,
   *       results: results.map(r => ({ id: r.id, status: 'success' })),
   *       timestamp: Date.now()
   *     };
   *
   *   } catch (error) {
   *     console.error(`Batch processing failed for ${items.length} items`, error);
   *     throw error; // Will trigger retry logic if configured
   *   }
   * }
   * ```
   */
  handler: (items: Static<TItem>[]) => TResponse;

  /**
   * Maximum number of items to collect before automatically flushing the batch.
   *
   * When this threshold is reached, the batch will be processed immediately
   * regardless of the time duration. This provides an upper bound on batch size
   * and ensures processing doesn't wait indefinitely for more items.
   *
   * **Size Selection Guidelines**:
   * - Database operations: 100-1000 items depending on record size
   * - API calls: 10-100 items depending on rate limits and payload size
   * - File operations: 10-50 items depending on processing complexity
   * - Memory operations: 1000+ items for simple transformations
   *
   * **Trade-offs**:
   * - Larger batches: Better efficiency, higher memory usage, longer latency
   * - Smaller batches: Lower latency, less efficiency, more frequent processing
   *
   * @default 10
   *
   * @example 50     // Good for database bulk operations
   * @example 100    // Good for API batching with rate limits
   * @example 1000   // Good for high-throughput log processing
   */
  maxSize?: number;

  /**
   * Maximum time to wait before flushing a batch, even if it hasn't reached maxSize.
   *
   * This timer starts when the first item is added to a partition and ensures
   * that items don't wait indefinitely for a batch to fill up. It provides
   * a maximum latency guarantee for batch processing.
   *
   * **Duration Selection Guidelines**:
   * - Real-time systems: 100ms - 1 second for low latency
   * - Background processing: 5 - 30 seconds for higher throughput
   * - Bulk operations: 1 - 5 minutes for maximum efficiency
   * - Log shipping: 30 seconds - 2 minutes for log aggregation
   *
   * **Latency Impact**:
   * - Shorter durations: Lower latency, potentially smaller batches
   * - Longer durations: Higher throughput, potentially better efficiency
   *
   * @default [1, "second"]
   *
   * @example [500, "milliseconds"]  // Low latency for real-time processing
   * @example [10, "seconds"]       // Balanced latency and throughput
   * @example [2, "minutes"]        // High throughput for bulk operations
   */
  maxDuration?: DurationLike;

  /**
   * Function to determine partition keys for grouping items into separate batches.
   *
   * Items with the same partition key are batched together, while items with
   * different keys are processed in separate batches. This enables:
   * - Processing different types of items with different logic
   * - Parallel processing of independent item groups
   * - Resource optimization based on item characteristics
   *
   * **Partitioning Strategies**:
   * - By type: Group similar operations together
   * - By destination: Group items going to the same endpoint
   * - By priority: Process high-priority items separately
   * - By size/complexity: Group items with similar processing requirements
   * - By tenant/user: Process items per customer or tenant
   *
   * **Partition Key Guidelines**:
   * - Use descriptive, consistent naming
   * - Keep key cardinality reasonable (avoid too many unique keys)
   * - Consider memory impact of multiple active partitions
   * - Balance between parallelism and resource usage
   *
   * If not provided, all items are placed in a single default partition.
   *
   * @param item - The validated item to determine partition for
   * @returns String key identifying the partition this item belongs to
   *
   * @example
   * ```ts
   * // Partition by operation type
   * partitionBy: (item) => item.operation,
   *
   * // Partition by priority and type
   * partitionBy: (item) => `${item.priority}-${item.type}`,
   *
   * // Partition by destination service
   * partitionBy: (item) => item.targetService,
   *
   * // Dynamic partitioning based on size
   * partitionBy: (item) => {
   *   const size = JSON.stringify(item).length;
   *   return size > 1000 ? 'large' : 'small';
   * }
   * ```
   */
  partitionBy?: (item: Static<TItem>) => string;

  /**
   * Maximum number of batch handlers that can execute simultaneously.
   *
   * This controls the level of parallelism for batch processing across
   * all partitions. Higher concurrency can improve throughput but may
   * increase resource usage and contention.
   *
   * **Concurrency Considerations**:
   * - Database operations: Limit based on connection pool size
   * - API calls: Consider rate limits and server capacity
   * - CPU-intensive operations: Set to number of CPU cores
   * - Memory-intensive operations: Consider available RAM
   * - I/O operations: Can be higher than CPU count
   *
   * **Resource Planning**:
   * - Each concurrent handler may use significant memory/connections
   * - Monitor resource usage and adjust based on system capacity
   * - Consider downstream system limits and capabilities
   *
   * @default 1
   *
   * @example 1      // Sequential processing, lowest resource usage
   * @example 4      // Moderate parallelism for balanced systems
   * @example 10     // High concurrency for I/O-bound operations
   */
  concurrency?: number;

  /**
   * Retry configuration for failed batch processing operations.
   *
   * When batch handlers fail, this configuration determines how and when
   * to retry the operation. Uses the `@alepha/retry` module for robust
   * retry logic with exponential backoff, jitter, and other strategies.
   *
   * **Retry Strategies**:
   * - Exponential backoff: Increasingly longer delays between attempts
   * - Fixed delays: Consistent intervals between retries
   * - Jitter: Random variation to avoid thundering herd problems
   *
   * **Failure Scenarios to Consider**:
   * - Temporary network issues
   * - Database connection problems
   * - Rate limiting from external services
   * - Resource exhaustion (memory, disk space)
   * - Downstream service temporary unavailability
   *
   * **Retry Guidelines**:
   * - Use exponential backoff for network-related failures
   * - Set reasonable max attempts to avoid infinite loops
   * - Consider the impact of retries on overall system performance
   * - Monitor retry patterns to identify systemic issues
   *
   * @example
   * ```ts
   * retry: {
   *   maxAttempts: 3,
   *   delay: [1, "second"],
   *   backoff: "exponential",
   *   maxDelay: [30, "seconds"],
   *   jitter: true
   * }
   * ```
   */
  retry?: Omit<RetryDescriptorOptions<() => Array<Static<TItem>>>, "handler">;
}

// ---------------------------------------------------------------------------------------------------------------------

export class BatchDescriptor<
  TItem extends TSchema,
  TResponse = any,
> extends Descriptor<BatchDescriptorOptions<TItem, TResponse>> {
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);

  protected readonly partitions = new Map();
  protected activeHandlers: PromiseWithResolvers<void>[] = [];

  // Computed properties with defaults
  protected get maxSize(): number {
    return this.options.maxSize ?? 10;
  }

  protected get concurrency(): number {
    return this.options.concurrency ?? 1;
  }

  protected get maxDuration(): DurationLike {
    return this.options.maxDuration ?? [1, "second"];
  }

  protected retry = $retry({
    ...this.options.retry,
    handler: this.options.handler,
  });

  /**
   * Pushes an item into the batch. The item will be processed
   * asynchronously with other items when the batch is flushed.
   */
  public async push(item: Static<TItem>): Promise<TResponse> {
    // 1. Validate the item against the schema
    const validatedItem = this.alepha.codec.decode(this.options.schema, item);

    // 2. Determine the partition key
    const partitionKey = this.options.partitionBy
      ? this.options.partitionBy(validatedItem)
      : "default";

    // 3. Get or create the partition state
    if (!this.partitions.has(partitionKey)) {
      this.partitions.set(partitionKey, {
        items: [],
        resolvers: [],
        flushing: false,
      });
    }
    const partition = this.partitions.get(partitionKey)!;

    // 4. Create a promise that will be resolved/rejected later
    return new Promise<TResponse>((resolve, reject) => {
      partition.resolvers.push({ resolve, reject });
      partition.items.push(validatedItem);

      this.log.trace(`Pushed item to batch partition '${partitionKey}'`, {
        currentSize: partition.items.length,
        maxSize: this.maxSize,
      });

      // 5. Check if the batch is full
      if (partition.items.length >= this.maxSize) {
        this.log.trace(`Batch partition '${partitionKey}' is full, flushing.`);
        this.flushPartition(partitionKey);
      } else if (!partition.timeout && !partition.flushing) {
        // 6. Start the timeout if it's not already running for this partition and not currently flushing
        partition.timeout = this.dateTime.createTimeout(() => {
          this.log.trace(
            `Batch partition '${partitionKey}' timed out, flushing.`,
          );
          this.flushPartition(partitionKey);
        }, this.maxDuration);
      }
    });
  }

  public async flush(partitionKey?: string): Promise<void> {
    const promises: Promise<void>[] = [];
    if (partitionKey) {
      if (this.partitions.has(partitionKey)) {
        promises.push(this.flushPartition(partitionKey));
      }
    } else {
      for (const key of this.partitions.keys()) {
        promises.push(this.flushPartition(key));
      }
    }
    await Promise.all(promises);
  }

  protected async flushPartition(partitionKey: string): Promise<void> {
    const partition = this.partitions.get(partitionKey);
    if (!partition || partition.items.length === 0) {
      this.partitions.delete(partitionKey);
      return;
    }

    // Clear the timeout and grab the items
    partition.timeout?.clear();
    const itemsToProcess = [...partition.items];
    const resolversToProcess = [...partition.resolvers];
    partition.items = [];
    partition.resolvers = [];

    // Mark partition as flushing to prevent race conditions
    partition.flushing = true;

    // Wait until there's a free slot (if at concurrency limit)
    while (this.activeHandlers.length >= this.concurrency) {
      this.log.trace(
        `Batch handler is at concurrency limit, waiting for a slot...`,
      );
      // Wait for any single handler to complete, not all of them
      await Promise.race(this.activeHandlers.map((it) => it.promise));
    }

    const promise = Promise.withResolvers<void>();
    this.activeHandlers.push(promise);
    let result: any;
    try {
      result = await this.alepha.context.run(() =>
        this.retry.run(itemsToProcess),
      );
      for (const { resolve } of resolversToProcess) {
        resolve(result);
      }
    } catch (error) {
      this.log.error(`Batch handler failed`, error);
      for (const { reject } of resolversToProcess) {
        reject(error);
      }
    } finally {
      promise.resolve(result);
      this.activeHandlers = this.activeHandlers.filter((it) => it !== promise);

      // Only delete partition if no new items arrived during processing
      const currentPartition = this.partitions.get(partitionKey);
      if (currentPartition?.flushing && currentPartition.items.length === 0) {
        this.partitions.delete(partitionKey);
      } else if (currentPartition) {
        // Reset flushing flag if partition still exists with items
        currentPartition.flushing = false;
      }
    }
  }

  protected readonly dispose = $hook({
    on: "stop",
    handler: async () => {
      this.log.debug("Flushing all remaining batch partitions on shutdown.");
      await this.flush();
      this.log.debug("All batch partitions flushed.");
    },
  });
}

$batch[KIND] = BatchDescriptor;
