import {
	__descriptor,
	type Async,
	KIND,
	NotImplementedError,
	OPTIONS,
	type Static,
	type TSchema,
} from "@alepha/core";
import type { DurationLike } from "@alepha/datetime";
import type { RetryDescriptorOptions } from "@alepha/retry";

const KEY = "BATCH";

export interface BatchDescriptorOptions<TItem extends TSchema> {
	/**
	 * A TypeBox schema to validate each item pushed to the batch.
	 */
	schema: TItem;

	/**
	 * The handler function that processes a batch of items.
	 */
	handler: (items: Static<TItem>[]) => Async<void>;

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
	partitionBy?: (item: TItem) => string;

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

export interface BatchDescriptor<TItem extends TSchema> {
	[KIND]: typeof KEY;
	[OPTIONS]: BatchDescriptorOptions<TItem>;

	/**
	 * Pushes an item into the batch. The item will be processed
	 * asynchronously with other items when the batch is flushed.
	 */
	push: (item: Static<TItem>) => Promise<void>;

	/**
	 * Manually triggers a flush for one or all partitions.
	 * @param partitionKey Optional. If provided, only flushes the specified partition. Otherwise, all partitions are flushed.
	 */
	flush: (partitionKey?: string) => Promise<void>;
}

/**
 * Creates a batch processor. This is useful for grouping multiple operations
 * (like API calls or database writes) into a single one to improve performance.
 */
export const $batch: {
	<TItem extends TSchema = any>(
		options: BatchDescriptorOptions<TItem>,
	): BatchDescriptor<TItem>;
	[KIND]: string;
} = <TItem extends TSchema>(
	options: BatchDescriptorOptions<TItem>,
): BatchDescriptor<TItem> => {
	__descriptor(KEY);

	const $: Partial<BatchDescriptor<TItem>> = {};
	$[KIND] = KEY;
	$[OPTIONS] = options;

	// These methods are placeholders and will be replaced by the BatchDescriptorProvider.
	$.push = async () => {
		throw new NotImplementedError(KEY);
	};
	$.flush = async () => {
		throw new NotImplementedError(KEY);
	};

	return $ as BatchDescriptor<TItem>;
};

$batch[KIND] = KEY;
