import type { Alepha, Module } from "@alepha/core";
import { AlephaQueue, QueueProvider } from "@alepha/queue";
import { RedisQueueProvider } from "./providers/RedisQueueProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/RedisQueueProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Plugin for Alepha Queue that provides Redis queue capabilities.
 *
 * @see {@link RedisQueueProvider}
 * @module alepha.queue.redis
 */
export class AlephaQueueRedis implements Module {
	public readonly name = "alepha.queue.redis";
	public readonly $services = (alepha: Alepha): Alepha =>
		alepha
			.with({
				provide: QueueProvider,
				use: RedisQueueProvider,
				optional: true,
			})
			.with(AlephaQueue);
}
