import {
  $hook,
  $inject,
  createPrimitive,
  type Infer,
  KIND,
  Primitive,
  type ZType,
} from "alepha";
import type { DurationLike } from "alepha/datetime";
import type { RetryPrimitiveOptions } from "alepha/retry";
import {
  type BatchContext,
  type BatchItemState,
  type BatchItemStatus,
  BatchProvider,
} from "../providers/BatchProvider.ts";

/**
 * Creates a batch processing primitive for efficient grouping and processing of multiple operations.
 */
export const $batch = <TItem extends ZType, TResponse>(
  options: BatchPrimitiveOptions<TItem, TResponse>,
): BatchPrimitive<TItem, TResponse> =>
  createPrimitive(BatchPrimitive<TItem, TResponse>, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface BatchPrimitiveOptions<TItem extends ZType, TResponse = any> {
  /**
   * Zod schema for validating each item added to the batch.
   */
  schema: TItem;

  /**
   * The batch processing handler function that processes arrays of validated items.
   */
  handler: (items: Infer<TItem>[]) => TResponse;

  /**
   * Maximum number of items to collect before automatically flushing the batch.
   */
  maxSize?: number;

  /**
   * Maximum number of items that can be queued in a single partition.
   * If exceeded, push() will throw an error.
   */
  maxQueueSize?: number;

  /**
   * Maximum time to wait before flushing a batch, even if it hasn't reached maxSize.
   */
  maxDuration?: DurationLike;

  /**
   * Function to determine partition keys for grouping items into separate batches.
   */
  partitionBy?: (item: Infer<TItem>) => string;

  /**
   * Maximum number of batch handlers that can execute simultaneously.
   */
  concurrency?: number;

  /**
   * Retry configuration for failed batch processing operations.
   */
  retry?: Omit<RetryPrimitiveOptions<() => Array<Infer<TItem>>>, "handler">;
}

// ---------------------------------------------------------------------------------------------------------------------

export type { BatchItemState, BatchItemStatus };

// ---------------------------------------------------------------------------------------------------------------------

export class BatchPrimitive<
  TItem extends ZType,
  TResponse = any,
> extends Primitive<BatchPrimitiveOptions<TItem, TResponse>> {
  protected readonly batchProvider = $inject(BatchProvider);
  protected readonly context: BatchContext<Infer<TItem>, TResponse>;

  constructor(
    ...args: ConstructorParameters<
      typeof Primitive<BatchPrimitiveOptions<TItem, TResponse>>
    >
  ) {
    super(...args);
    this.context = this.batchProvider.createContext(this.alepha, {
      handler: this.options.handler,
      maxSize: this.options.maxSize,
      maxQueueSize: this.options.maxQueueSize,
      maxDuration: this.options.maxDuration,
      partitionBy: this.options.partitionBy,
      concurrency: this.options.concurrency,
      retry: this.options.retry,
    });
  }

  /**
   * Pushes an item into the batch and returns immediately with a unique ID.
   * The item will be processed asynchronously with other items when the batch is flushed.
   * Use wait(id) to get the processing result.
   */
  public async push(item: Infer<TItem>): Promise<string> {
    // Validate the item against the schema
    const validatedItem = this.alepha.codec.validate(this.options.schema, item);
    return this.batchProvider.push(this.context, validatedItem);
  }

  /**
   * Wait for a specific item to be processed and get its result.
   * @param id The item ID returned from push()
   * @returns The processing result
   * @throws If the item doesn't exist or processing failed
   */
  public async wait(id: string): Promise<TResponse> {
    return this.batchProvider.wait(this.context, id);
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
    return this.batchProvider.status(this.context, id);
  }

  /**
   * Flush all partitions or a specific partition.
   */
  public async flush(partitionKey?: string): Promise<void> {
    return this.batchProvider.flush(this.context, partitionKey);
  }

  /**
   * Clears completed and failed items from memory.
   * Call this periodically in long-running applications to prevent memory leaks.
   *
   * @param status Optional: only clear items with this specific status ('completed' or 'failed')
   * @returns The number of items cleared
   */
  public clearCompleted(status?: "completed" | "failed"): number {
    return this.batchProvider.clearCompleted(this.context, status);
  }

  protected readonly onReady = $hook({
    on: "ready",
    handler: async () => {
      await this.batchProvider.markReady(this.context);
    },
  });
}

$batch[KIND] = BatchPrimitive;
