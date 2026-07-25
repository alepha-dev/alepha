import { $hook, $inject, type Alepha, AlephaError } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider, type DurationLike } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { type RetryBackoffOptions, RetryProvider } from "alepha/retry";

// ---------------------------------------------------------------------------------------------------------------------

export interface BatchOptions<TItem, TResponse = any> {
  /**
   * The batch processing handler function that processes arrays of validated items.
   */
  handler: (items: TItem[]) => TResponse;

  /**
   * Maximum number of items to collect before automatically flushing the batch.
   *
   * @default 10
   */
  maxSize?: number;

  /**
   * Maximum number of items that can be queued in a single partition.
   * If exceeded, push() will throw an error.
   */
  maxQueueSize?: number;

  /**
   * Maximum time to wait before flushing a batch, even if it hasn't reached maxSize.
   *
   * @default [1, "second"]
   */
  maxDuration?: DurationLike;

  /**
   * Function to determine partition keys for grouping items into separate batches.
   */
  partitionBy?: (item: TItem) => string;

  /**
   * Maximum number of batch handlers that can execute simultaneously.
   *
   * @default 1
   */
  concurrency?: number;

  /**
   * Retry configuration for failed batch processing operations.
   */
  retry?: {
    /**
     * The maximum number of attempts.
     *
     * @default 3
     */
    max?: number;

    /**
     * The backoff strategy for delays between retries.
     * Can be a fixed number (in ms) or a configuration object for exponential backoff.
     *
     * @default { initial: 200, factor: 2, jitter: true }
     */
    backoff?: number | RetryBackoffOptions;

    /**
     * An overall time limit for all retry attempts combined.
     *
     * e.g., `[5, 'seconds']`
     */
    maxDuration?: DurationLike;

    /**
     * A function that determines if a retry should be attempted based on the error.
     *
     * @default (error) => true (retries on any error)
     */
    when?: (error: Error) => boolean;

    /**
     * A custom callback for when a retry attempt fails.
     * This is called before the delay.
     */
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
 * Context object that holds all state for a batch processor instance.
 */
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
 * Service for batch processing operations.
 * Provides methods to manage batches of items with automatic flushing based on size or time.
 */
export class BatchProvider {
  protected readonly log = $logger();
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly retryProvider = $inject(RetryProvider);
  protected readonly crypto = $inject(CryptoProvider);

  /**
   * All active batch contexts managed by this provider.
   */
  protected readonly contexts = new Set<BatchContext<any, any>>();

  /**
   * Creates a new batch context with the given options.
   */
  createContext<TItem, TResponse>(
    alepha: Alepha,
    options: BatchOptions<TItem, TResponse>,
  ): BatchContext<TItem, TResponse> {
    const context: BatchContext<TItem, TResponse> = {
      options,
      itemStates: new Map(),
      partitions: new Map(),
      activeHandlers: [],
      isShuttingDown: false,
      isReady: false,
      alepha,
    };
    this.contexts.add(context);
    return context;
  }

  /**
   * Shutdown hook - flushes all batch contexts on application stop.
   */
  protected readonly onStop = $hook({
    on: "stop",
    priority: "first",
    handler: async () => {
      if (this.contexts.size === 0) {
        return;
      }
      this.log.debug(`Shutting down ${this.contexts.size} batch context(s)...`);
      const promises: Promise<void>[] = [];
      for (const context of this.contexts) {
        promises.push(this.shutdown(context));
      }
      await Promise.all(promises);
      this.log.debug("All batch contexts shut down");
    },
  });

  /**
   * Get the effective maxSize for a context.
   */
  protected getMaxSize<TItem, TResponse>(
    context: BatchContext<TItem, TResponse>,
  ): number {
    return context.options.maxSize ?? 10;
  }

  /**
   * Get the effective concurrency for a context.
   */
  protected getConcurrency<TItem, TResponse>(
    context: BatchContext<TItem, TResponse>,
  ): number {
    return context.options.concurrency ?? 1;
  }

  /**
   * Get the effective maxDuration for a context.
   */
  protected getMaxDuration<TItem, TResponse>(
    context: BatchContext<TItem, TResponse>,
  ): DurationLike {
    return context.options.maxDuration ?? [1, "second"];
  }

  /**
   * Pushes an item into the batch and returns immediately with a unique ID.
   * The item will be processed asynchronously with other items when the batch is flushed.
   * Use wait(id) to get the processing result.
   *
   * @throws Error if maxQueueSize is exceeded
   */
  push<TItem, TResponse>(
    context: BatchContext<TItem, TResponse>,
    item: TItem,
  ): string {
    // 1. Generate unique ID
    const id = this.crypto.randomUUID();

    // 2. Determine the partition key (with error handling)
    let partitionKey: string;
    try {
      partitionKey = context.options.partitionBy
        ? context.options.partitionBy(item)
        : "default";
    } catch (error) {
      this.log.warn(
        "partitionBy function threw an error, using 'default' partition",
        { error },
      );
      partitionKey = "default";
    }

    // 3. Create item state
    const itemState: BatchItemState<TItem, TResponse> = {
      id,
      item,
      partitionKey,
      status: "pending",
    };

    // CAUTION: Do not log.debug/info here as it may cause infinite loops if logging is batched

    // 4. Get or create the partition state
    if (!context.partitions.has(partitionKey)) {
      context.partitions.set(partitionKey, {
        itemIds: [],
        flushing: false,
      });
    }
    const partition = context.partitions.get(partitionKey)!;

    // 5. Check maxQueueSize BEFORE registering the item state. Registering
    // first and then throwing left an entry the caller has no id for: it
    // joined no partition, stayed "pending" forever, and the map grew on
    // every rejected push — so sustained backpressure leaked memory.
    if (
      context.options.maxQueueSize !== undefined &&
      partition.itemIds.length >= context.options.maxQueueSize
    ) {
      throw new AlephaError(
        `Batch queue size exceeded for partition '${partitionKey}' (max: ${context.options.maxQueueSize})`,
      );
    }

    context.itemStates.set(id, itemState);

    // 6. Add item ID to partition
    partition.itemIds.push(id);

    const maxSize = this.getMaxSize(context);
    const maxDuration = this.getMaxDuration(context);

    // 7. Only start processing if the app is ready (after "ready" hook)
    // During startup, items are just buffered in memory
    if (context.isReady) {
      // Check if the batch is full
      if (partition.itemIds.length >= maxSize) {
        this.log.trace(
          `Batch partition '${partitionKey}' is full, flushing...`,
        );
        this.flushPartition(context, partitionKey).catch((error) =>
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
          this.flushPartition(context, partitionKey).catch((error) =>
            this.log.error(
              `Failed to flush batch partition '${partitionKey}' on timeout`,
              error,
            ),
          );
        }, maxDuration);
      }
    } else {
      // Not ready yet - just buffer items, no size checks or timeouts
      this.log.trace(
        `Buffering item in partition '${partitionKey}' (app not ready yet, ${partition.itemIds.length} items buffered)`,
      );
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
  async wait<TItem, TResponse>(
    context: BatchContext<TItem, TResponse>,
    id: string,
  ): Promise<TResponse> {
    const itemState = context.itemStates.get(id);
    if (!itemState) {
      throw new AlephaError(`Item with id '${id}' not found`);
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
  status<TItem, TResponse>(
    context: BatchContext<TItem, TResponse>,
    id: string,
  ):
    | { status: "pending" | "processing" }
    | { status: "completed"; result: TResponse }
    | { status: "failed"; error: Error }
    | undefined {
    const itemState = context.itemStates.get(id);
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

  /**
   * Clears completed and failed items from the context to free memory.
   * Returns the number of items cleared.
   *
   * @param context The batch context
   * @param status Optional: only clear items with this specific status ('completed' or 'failed')
   * @returns The number of items cleared
   */
  clearCompleted<TItem, TResponse>(
    context: BatchContext<TItem, TResponse>,
    status?: "completed" | "failed",
  ): number {
    let count = 0;
    for (const [id, state] of context.itemStates) {
      if (status) {
        if (state.status === status) {
          context.itemStates.delete(id);
          count++;
        }
      } else if (state.status === "completed" || state.status === "failed") {
        context.itemStates.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * Flush all partitions or a specific partition.
   */
  async flush<TItem, TResponse>(
    context: BatchContext<TItem, TResponse>,
    partitionKey?: string,
  ): Promise<void> {
    const promises: Promise<void>[] = [];
    if (partitionKey) {
      if (context.partitions.has(partitionKey)) {
        promises.push(this.flushPartition(context, partitionKey));
      }
    } else {
      for (const key of context.partitions.keys()) {
        promises.push(this.flushPartition(context, key));
      }
    }
    await Promise.all(promises);
  }

  /**
   * Flush a specific partition.
   */
  protected async flushPartition<TItem, TResponse>(
    context: BatchContext<TItem, TResponse>,
    partitionKey: string,
    limit?: number,
  ): Promise<void> {
    const partition = context.partitions.get(partitionKey);
    if (!partition || partition.itemIds.length === 0) {
      context.partitions.delete(partitionKey);
      return;
    }

    // Clear the timeout and grab the item IDs (up to limit if specified)
    partition.timeout?.clear();
    partition.timeout = undefined;
    const itemsToTake =
      limit !== undefined
        ? Math.min(limit, partition.itemIds.length)
        : partition.itemIds.length;
    const itemIdsToProcess = partition.itemIds.splice(0, itemsToTake);

    // Mark partition as flushing to prevent race conditions
    partition.flushing = true;

    // Get the items and mark them as processing
    const itemsToProcess: TItem[] = [];
    for (const id of itemIdsToProcess) {
      const itemState = context.itemStates.get(id);
      if (itemState) {
        itemState.status = "processing";
        itemsToProcess.push(itemState.item);
      }
    }

    const concurrency = this.getConcurrency(context);
    const maxDuration = this.getMaxDuration(context);

    // Wait until there's a free slot (if at concurrency limit)
    while (context.activeHandlers.length >= concurrency) {
      this.log.trace(
        `Batch handler is at concurrency limit, waiting for a slot...`,
      );
      // Wait for any single handler to complete, not all of them
      await Promise.race(context.activeHandlers.map((it) => it.promise));
    }

    const promise = Promise.withResolvers<void>();
    context.activeHandlers.push(promise);
    let result: any;
    try {
      result = await context.alepha.context.run(() =>
        // during shutdown, call handler directly to avoid retry cancellation
        context.isShuttingDown
          ? context.options.handler(itemsToProcess)
          : this.retryProvider.retry(
              {
                ...context.options.retry,
                handler: context.options.handler,
              },
              itemsToProcess,
            ),
      );

      // Mark all items as completed and resolve their promises
      for (const id of itemIdsToProcess) {
        const itemState = context.itemStates.get(id);
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
        const itemState = context.itemStates.get(id);
        if (itemState) {
          itemState.status = "failed";
          itemState.error = error as Error;
          // Only reject if someone is waiting (promise was created)
          itemState.reject?.(error as Error);
        }
      }
    } finally {
      promise.resolve();
      context.activeHandlers = context.activeHandlers.filter(
        (it) => it !== promise,
      );

      // Only delete partition if no new items arrived during processing
      const currentPartition = context.partitions.get(partitionKey);
      if (currentPartition?.flushing && currentPartition.itemIds.length === 0) {
        context.partitions.delete(partitionKey);
      } else if (currentPartition) {
        // Reset flushing flag if partition still exists with items
        currentPartition.flushing = false;

        // Restart timeout for items that arrived during flush
        if (currentPartition.itemIds.length > 0 && !currentPartition.timeout) {
          currentPartition.timeout = this.dateTime.createTimeout(() => {
            this.log.trace(
              `Batch partition '${partitionKey}' timed out, flushing...`,
            );
            this.flushPartition(context, partitionKey).catch((error) =>
              this.log.error(
                `Failed to flush batch partition '${partitionKey}' on timeout`,
                error,
              ),
            );
          }, maxDuration);
        }
      }
    }
  }

  /**
   * Mark the context as ready and start processing buffered items.
   * Called after the "ready" hook.
   */
  async markReady<TItem, TResponse>(
    context: BatchContext<TItem, TResponse>,
  ): Promise<void> {
    this.log.debug(
      "Batch processor is now ready, starting to process buffered items...",
    );
    context.isReady = true;
    await this.startProcessing(context);
  }

  /**
   * Mark the context as shutting down and flush all remaining items.
   */
  async shutdown<TItem, TResponse>(
    context: BatchContext<TItem, TResponse>,
  ): Promise<void> {
    this.log.debug("Flushing all remaining batch partitions on shutdown...");
    context.isShuttingDown = true;
    await this.flush(context);
    this.log.debug("All batch partitions flushed");
  }

  /**
   * Called after the "ready" hook to start processing buffered items that were
   * pushed during startup. This checks all partitions and starts timeouts/flushes
   * for items that were accumulated before the app was ready.
   */
  protected async startProcessing<TItem, TResponse>(
    context: BatchContext<TItem, TResponse>,
  ): Promise<void> {
    const maxSize = this.getMaxSize(context);
    const maxDuration = this.getMaxDuration(context);

    for (const [partitionKey, partition] of context.partitions.entries()) {
      if (partition.itemIds.length === 0) {
        continue;
      }

      this.log.trace(
        `Starting processing for partition '${partitionKey}' with ${partition.itemIds.length} buffered items`,
      );

      // Flush batches of maxSize while we have items >= maxSize
      while (partition.itemIds.length >= maxSize) {
        this.log.trace(
          `Partition '${partitionKey}' has ${partition.itemIds.length} items, flushing batch of ${maxSize}...`,
        );
        await this.flushPartition(context, partitionKey, maxSize);
      }

      // After flushing full batches, start timeout for any remaining items
      if (
        partition.itemIds.length > 0 &&
        !partition.timeout &&
        !partition.flushing
      ) {
        this.log.trace(
          `Starting timeout for partition '${partitionKey}' with ${partition.itemIds.length} remaining items`,
        );
        partition.timeout = this.dateTime.createTimeout(() => {
          this.log.trace(
            `Batch partition '${partitionKey}' timed out, flushing...`,
          );
          this.flushPartition(context, partitionKey).catch((error) =>
            this.log.error(
              `Failed to flush partition '${partitionKey}' on timeout after startup`,
              error,
            ),
          );
        }, maxDuration);
      }
    }
  }
}
