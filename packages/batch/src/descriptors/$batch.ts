import { randomUUID } from "node:crypto";
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

interface PartitionState {
  itemIds: string[];
  timeout?: { clear: () => void };
  flushing: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------

export class BatchDescriptor<
  TItem extends TSchema,
  TResponse = any,
> extends Descriptor<BatchDescriptorOptions<TItem, TResponse>> {
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);

  protected readonly itemStates = new Map<
    string,
    BatchItemState<Static<TItem>, TResponse>
  >();
  protected readonly partitions = new Map<string, PartitionState>();
  protected activeHandlers: PromiseWithResolvers<void>[] = [];
  protected isShuttingDown = false;

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
   * Pushes an item into the batch and returns immediately with a unique ID.
   * The item will be processed asynchronously with other items when the batch is flushed.
   * Use wait(id) to get the processing result.
   */
  public async push(item: Static<TItem>): Promise<string> {
    // 1. Validate the item against the schema
    const validatedItem = this.alepha.codec.validate(this.options.schema, item);

    // 2. Generate unique ID
    const id = randomUUID();

    // 3. Determine the partition key
    const partitionKey = this.options.partitionBy
      ? this.options.partitionBy(validatedItem)
      : "default";

    // 4. Create item state
    const itemState: BatchItemState<Static<TItem>, TResponse> = {
      id,
      item: validatedItem,
      partitionKey,
      status: "pending",
    };

    // CAUTION: Do not log.debug/info here as it may cause infinite loops if logging is batched
    // log.trace is safe

    this.log.trace("Pushing item to batch", {
      id,
      partitionKey,
      item: validatedItem,
    });

    this.itemStates.set(id, itemState);

    // 5. Get or create the partition state
    if (!this.partitions.has(partitionKey)) {
      this.partitions.set(partitionKey, {
        itemIds: [],
        flushing: false,
      });
    }
    const partition = this.partitions.get(partitionKey)!;

    // 6. Add item ID to partition
    partition.itemIds.push(id);

    // 7. Check if the batch is full
    if (partition.itemIds.length >= this.maxSize) {
      this.log.trace(`Batch partition '${partitionKey}' is full, flushing...`);
      this.flushPartition(partitionKey).catch((error) =>
        this.log.error(
          `Failed to flush batch partition '${partitionKey}' on max size`,
          error,
        ),
      );
    } else if (!partition.timeout && !partition.flushing) {
      // 8. Start the timeout if it's not already running for this partition and not currently flushing
      partition.timeout = this.dateTime.createTimeout(() => {
        this.log.trace(
          `Batch partition '${partitionKey}' timed out, flushing...`,
        );
        this.flushPartition(partitionKey).catch((error) =>
          this.log.error(
            `Failed to flush batch partition '${partitionKey}' on timeout`,
            error,
          ),
        );
      }, this.maxDuration);
    }

    // 9. Return ID immediately
    return id;
  }

  /**
   * Wait for a specific item to be processed and get its result.
   * @param id The item ID returned from push()
   * @returns The processing result
   * @throws If the item doesn't exist or processing failed
   */
  public async wait(id: string): Promise<TResponse> {
    const itemState = this.itemStates.get(id);
    if (!itemState) {
      throw new Error(`Item with id '${id}' not found`);
    }

    // If already completed or failed, return immediately
    if (itemState.status === "completed") {
      return itemState.result!;
    }
    if (itemState.status === "failed") {
      throw itemState.error!;
    }

    // Create promise on-demand if not already created
    if (!itemState.promise) {
      itemState.promise = new Promise<TResponse>((resolve, reject) => {
        itemState.resolve = resolve;
        itemState.reject = reject;
      });
    }

    return itemState.promise;
  }

  /**
   * Get the current status of an item.
   * @param id The item ID returned from push()
   * @returns Status information or undefined if item doesn't exist
   */
  public status(
    id: string,
  ):
    | { status: "pending" | "processing" }
    | { status: "completed"; result: TResponse }
    | { status: "failed"; error: Error }
    | undefined {
    const itemState = this.itemStates.get(id);
    if (!itemState) {
      return undefined;
    }

    if (itemState.status === "completed") {
      return { status: "completed", result: itemState.result! };
    }
    if (itemState.status === "failed") {
      return { status: "failed", error: itemState.error! };
    }
    return { status: itemState.status };
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
    if (!partition || partition.itemIds.length === 0) {
      this.partitions.delete(partitionKey);
      return;
    }

    // Clear the timeout and grab the item IDs
    partition.timeout?.clear();
    partition.timeout = undefined;
    const itemIdsToProcess = [...partition.itemIds];
    partition.itemIds = [];

    // Mark partition as flushing to prevent race conditions
    partition.flushing = true;

    // Get the items and mark them as processing
    const itemsToProcess: Static<TItem>[] = [];
    for (const id of itemIdsToProcess) {
      const itemState = this.itemStates.get(id);
      if (itemState) {
        itemState.status = "processing";
        itemsToProcess.push(itemState.item);
      }
    }

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
        // during shutdown, call handler directly to avoid retry cancellation
        this.isShuttingDown
          ? this.options.handler(itemsToProcess)
          : this.retry.run(itemsToProcess),
      );

      // Mark all items as completed and resolve their promises
      for (const id of itemIdsToProcess) {
        const itemState = this.itemStates.get(id);
        if (itemState) {
          itemState.status = "completed";
          itemState.result = result;
          // Only resolve if someone is waiting
          itemState.resolve?.(result);
        }
      }
    } catch (error) {
      this.log.error(`Batch handler failed`, error);

      // Mark all items as failed and reject their promises
      for (const id of itemIdsToProcess) {
        const itemState = this.itemStates.get(id);
        if (itemState) {
          itemState.status = "failed";
          itemState.error = error as Error;
          // Only reject if someone is waiting (promise was created)
          itemState.reject?.(error as Error);
        }
      }
    } finally {
      promise.resolve(result);
      this.activeHandlers = this.activeHandlers.filter((it) => it !== promise);

      // Only delete partition if no new items arrived during processing
      const currentPartition = this.partitions.get(partitionKey);
      if (currentPartition?.flushing && currentPartition.itemIds.length === 0) {
        this.partitions.delete(partitionKey);
      } else if (currentPartition) {
        // Reset flushing flag if partition still exists with items
        currentPartition.flushing = false;

        // Restart timeout for items that arrived during flush
        if (currentPartition.itemIds.length > 0 && !currentPartition.timeout) {
          currentPartition.timeout = this.dateTime.createTimeout(() => {
            this.log.trace(
              `Batch partition '${partitionKey}' timed out, flushing...`,
            );
            this.flushPartition(partitionKey).catch((error) =>
              this.log.error(
                `Failed to flush batch partition '${partitionKey}' on timeout`,
                error,
              ),
            );
          }, this.maxDuration);
        }
      }
    }
  }

  protected readonly dispose = $hook({
    on: "stop",
    priority: "first",
    handler: async () => {
      this.log.debug("Flushing all remaining batch partitions on shutdown...");
      this.isShuttingDown = true;
      await this.flush();
      this.log.debug("All batch partitions flushed");
    },
  });
}

$batch[KIND] = BatchDescriptor;
