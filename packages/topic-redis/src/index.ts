import type { Alepha, Module } from "@alepha/core";
import { AlephaTopic, TopicProvider } from "@alepha/topic";
import { RedisTopicProvider } from "./providers/RedisTopicProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/RedisTopicProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Plugin for Alepha Topic that provides Redis pub/sub capabilities.
 *
 * @see {@link RedisTopicProvider}
 * @module alepha.topic.redis
 */
export class AlephaTopicRedis implements Module {
	public readonly name = "alepha.topic.redis";
	public readonly $services = (alepha: Alepha): Alepha =>
		alepha
			.with({
				provide: TopicProvider,
				use: RedisTopicProvider,
				optional: true,
			})
			.with(AlephaTopic);
}
