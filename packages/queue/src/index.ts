import type { Alepha, Module } from "@alepha/core";
import { __bind } from "@alepha/core";
import { $queue } from "./descriptors/$queue.ts";
import { MemoryQueueProvider } from "./providers/MemoryQueueProvider.ts";
import { QueueDescriptorProvider } from "./providers/QueueDescriptorProvider.ts";
import { QueueProvider } from "./providers/QueueProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$consumer.ts";
export * from "./descriptors/$queue.ts";
export * from "./providers/MemoryQueueProvider.ts";
export * from "./providers/QueueDescriptorProvider.ts";
export * from "./providers/QueueProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Alepha Queue Module
 *
 * Generic interface for queueing.
 * Gives you the ability to create queues and consumers.
 * This module provides only a memory implementation of the queue provider.
 *
 * @see {@link $queue}
 * @see {@link $consumer}
 * @module alepha.queue
 */
export class AlephaQueue implements Module {
	public readonly name = "alepha.queue";
	public readonly $services = (alepha: Alepha) =>
		alepha
			.with({
				provide: QueueProvider,
				use: MemoryQueueProvider,
				optional: true,
			})
			.with(QueueDescriptorProvider);
}

__bind($queue, AlephaQueue);
