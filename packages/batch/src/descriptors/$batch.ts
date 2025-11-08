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
   */
  schema: TItem;

  /**
   * The batch processing handler function that processes arrays of validated items.
   */
  handler: (items: Static<TItem>[]) => TResponse;

  /**
   * Maximum number of items to collect before automatically flushing the batch.
   */
  maxSize?: number;

  /**
   * Maximum time to wait before flushing a batch, even if it hasn't reached maxSize.
   */
  maxDuration?: DurationLike;

  /**
   * Function to determine partition keys for grouping items into separate batches.
   */
  partitionBy?: (item: Static<TItem>) => string;

  /**
   * Maximum number of batch handlers that can execute simultaneously.
   */
  concurrency?: number;

  /**
   * Retry configuration for failed batch processing operations.
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
    const validatedItem = this.alepha.codec.validate(this.options.schema, item);

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
