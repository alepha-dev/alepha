import {
	$hook,
	$inject,
	$logger,
	createDescriptor,
	Descriptor,
	KIND,
	type Static,
	type TSchema,
} from "@alepha/core";
import { DateTimeProvider, type DurationLike } from "@alepha/datetime";
import { $retry, type RetryDescriptorOptions } from "@alepha/retry";

/**
 * Creates a batch processor. This is useful for grouping multiple operations
 * (like API calls or database writes) into a single one to improve performance.
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
	 * A TypeBox schema to validate each item pushed to the batch.
	 */
	schema: TItem;

	/**
	 * The handler function that processes a batch of items.
	 */
	handler: (items: Static<TItem>[]) => TResponse;

	/**
	 * The maximum number of items in a batch. When this size is reached,
	 * the batch is flushed automatically.
	 * @default 10
	 */
	maxSize?: number;

	/**
	 * The maximum duration to wait before flushing a batch, even if it's not full.
	 * Starts from the moment the first item is added to a partition.
	 * @default [1, "second"]
	 */
	maxDuration?: DurationLike;

	/**
	 * A function to determine the partition key for an item. Items with the
	 * same key are batched together. If not provided, all items are placed in a single, default partition.
	 */
	partitionBy?: (item: Static<TItem>) => string;

	/**
	 * The maximum number of concurrent `handler` executions.
	 * @default 1
	 */
	concurrency?: number;

	/**
	 * Retry options for the batch handler if it fails.
	 * Leverages the `@alepha/retry` module.
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
		const validatedItem = this.alepha.parse(this.options.schema, item);

		// 2. Determine the partition key
		const partitionKey = this.options.partitionBy
			? this.options.partitionBy(validatedItem)
			: "default";

		// 3. Get or create the partition state
		if (!this.partitions.has(partitionKey)) {
			this.partitions.set(partitionKey, { items: [], resolvers: [] });
		}
		const partition = this.partitions.get(partitionKey)!;

		// 4. Create a promise that will be resolved/rejected later
		return new Promise<TResponse>((resolve, reject) => {
			partition.resolvers.push({ resolve, reject });
			partition.items.push(validatedItem);

			this.log.trace(`Pushed item to batch partition '${partitionKey}'`, {
				currentSize: partition.items.length,
				maxSize: this.options.maxSize,
			});

			// 5. Check if the batch is full
			if (partition.items.length >= this.options.maxSize!) {
				this.log.trace(`Batch partition '${partitionKey}' is full, flushing.`);
				this.flushPartition(partitionKey);
			} else if (!partition.timeout) {
				// 6. Start the timeout if it's not already running for this partition
				partition.timeout = this.dateTime.createTimeout(() => {
					this.log.trace(
						`Batch partition '${partitionKey}' timed out, flushing.`,
					);
					this.flushPartition(partitionKey);
				}, this.options.maxDuration ?? [1, "second"]);
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
		this.partitions.delete(partitionKey);

		if (this.activeHandlers.length >= this.options.concurrency!) {
			this.log.trace(`Batch handler is busy, waiting...`);
			await Promise.all(this.activeHandlers.map((it) => it.promise));
		}

		const promise = Promise.withResolvers<void>();
		this.activeHandlers.push(promise);
		let result: any;
		try {
			result = await this.alepha.context.run(() =>
				this.retry.run(itemsToProcess),
			);
			resolversToProcess.forEach(({ resolve }) => resolve(result));
		} catch (error) {
			this.log.error(`Batch handler failed`, error);
			resolversToProcess.forEach(({ reject }) => reject(error));
		} finally {
			promise.resolve(result);
			this.activeHandlers = this.activeHandlers.filter((it) => it !== promise);
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
