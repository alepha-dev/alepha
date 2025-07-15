import {
	$hook,
	$inject,
	$logger,
	Alepha,
	type HookDescriptor,
	type Logger,
	OPTIONS,
	type Static,
	type TSchema,
} from "@alepha/core";
import { DateTimeProvider, type Timeout } from "@alepha/datetime";
import { createRetryHandler } from "@alepha/retry";
import type { BatchDescriptorOptions } from "../descriptors/$batch.ts";
import { $batch } from "../descriptors/$batch.ts";

interface PartitionState<TItem extends TSchema> {
	items: Static<TItem>[];
	timeout?: Timeout;
	// Promises to resolve/reject when the batch is processed
	resolvers: Array<{
		resolve: (result?: any) => void;
		reject: (reason?: any) => void;
	}>;
}

interface BatchInstance<TItem extends TSchema> {
	id: string;
	options: BatchDescriptorOptions<TItem>;
	partitions: Map<string, PartitionState<TItem>>;
	activeHandlers: PromiseWithResolvers<void>[];
	handler: (items: Static<TItem>[]) => Promise<void>;
}

/**
 * Process every $batch.
 */
export class BatchDescriptorProvider {
	protected readonly alepha: Alepha = $inject(Alepha);
	protected readonly log: Logger = $logger();
	protected readonly dateTimeProvider: DateTimeProvider =
		$inject(DateTimeProvider);
	protected readonly instances: Map<string, BatchInstance<any>> = new Map();

	protected readonly configure: HookDescriptor<"configure"> = $hook({
		on: "configure",
		handler: () => {
			const descriptors = this.alepha.getDescriptorValues($batch);

			for (const { value, instance, key } of descriptors) {
				const id = `${instance.constructor.name}:${key}`;
				const options = value[OPTIONS] as BatchDescriptorOptions<any>;

				// Create a retry-wrapped handler
				const handler = createRetryHandler(
					{
						...options.retry,
						handler: options.handler,
					},
					this.dateTimeProvider,
				);

				const batchInstance: BatchInstance<any> = {
					id,
					options: {
						maxSize: 10,
						maxDuration: [1, "second"],
						concurrency: 1,
						...options,
					},
					partitions: new Map(),
					activeHandlers: [],
					handler,
				};
				this.instances.set(id, batchInstance);

				instance[key].push = (item: any) => this.push(id, item);
				instance[key].flush = (partitionKey?: string) =>
					this.flush(id, partitionKey);
			}
		},
	});

	// On application stop, flush all pending batches gracefully.
	protected readonly onStop: HookDescriptor<"stop"> = $hook({
		on: "stop",
		handler: async () => {
			const flushPromises: Promise<void>[] = [];
			for (const id of this.instances.keys()) {
				flushPromises.push(this.flush(id));
			}
			await Promise.all(flushPromises);
		},
	});

	protected async push<TItem>(id: string, item: TItem): Promise<void> {
		const instance = this.instances.get(id);
		if (!instance) throw new Error(`Batch instance ${id} not found.`);

		// 1. Validate the item against the schema
		const validatedItem = this.alepha.parse(instance.options.schema, item);

		// 2. Determine the partition key
		const partitionKey = instance.options.partitionBy
			? instance.options.partitionBy(validatedItem)
			: "default";

		// 3. Get or create the partition state
		if (!instance.partitions.has(partitionKey)) {
			instance.partitions.set(partitionKey, { items: [], resolvers: [] });
		}
		const partition = instance.partitions.get(partitionKey)!;

		// 4. Create a promise that will be resolved/rejected later
		return new Promise<void>((resolve, reject) => {
			partition.resolvers.push({ resolve, reject });
			partition.items.push(validatedItem);

			this.log.trace(
				`Pushed item to batch '${id}' partition '${partitionKey}'`,
				{
					currentSize: partition.items.length,
					maxSize: instance.options.maxSize,
				},
			);

			// 5. Check if the batch is full
			if (partition.items.length >= instance.options.maxSize!) {
				this.log.trace(
					`Batch '${id}' partition '${partitionKey}' is full, flushing.`,
				);
				this.flushPartition(instance, partitionKey);
			} else if (!partition.timeout) {
				// 6. Start the timeout if it's not already running for this partition
				partition.timeout = this.dateTimeProvider.timeout(() => {
					this.log.trace(
						`Batch '${id}' partition '${partitionKey}' timed out, flushing.`,
					);
					this.flushPartition(instance, partitionKey);
				}, instance.options.maxDuration ?? [1, "second"]);
			}
		});
	}

	protected async flush(id: string, partitionKey?: string): Promise<void> {
		const instance = this.instances.get(id);
		if (!instance) return;

		const promises: Promise<void>[] = [];
		if (partitionKey) {
			if (instance.partitions.has(partitionKey)) {
				promises.push(this.flushPartition(instance, partitionKey));
			}
		} else {
			for (const key of instance.partitions.keys()) {
				promises.push(this.flushPartition(instance, key));
			}
		}
		await Promise.all(promises);
	}

	protected async flushPartition<TItem extends TSchema>(
		instance: BatchInstance<TItem>,
		partitionKey: string,
	): Promise<void> {
		const partition = instance.partitions.get(partitionKey);
		if (!partition || partition.items.length === 0) {
			instance.partitions.delete(partitionKey);
			return;
		}

		// Clear the timeout and grab the items
		partition.timeout?.clear();
		const itemsToProcess = [...partition.items];
		const resolversToProcess = [...partition.resolvers];
		partition.items = [];
		partition.resolvers = [];
		instance.partitions.delete(partitionKey);

		if (instance.activeHandlers.length >= instance.options.concurrency!) {
			this.log.trace(`Batch '${instance.id}' handler is busy, waiting...`);
			await Promise.all(instance.activeHandlers.map((it) => it.promise));
		}

		const promise = Promise.withResolvers<void>();
		instance.activeHandlers.push(promise);
		let result: any;
		try {
			result = await this.alepha.context.run(() =>
				instance.handler(itemsToProcess),
			);
			resolversToProcess.forEach(({ resolve }) => resolve(result));
		} catch (error) {
			this.log.error(`Batch '${instance.id}' handler failed`, error);
			resolversToProcess.forEach(({ reject }) => reject(error));
		} finally {
			promise.resolve(result);
			instance.activeHandlers = instance.activeHandlers.filter(
				(it) => it !== promise,
			);
		}
	}
}
