import { __bind, type Alepha, type Module } from "@alepha/core";
import { $topic } from "./descriptors/$topic.ts";
import { MemoryTopicProvider } from "./providers/MemoryTopicProvider.ts";
import { TopicDescriptorProvider } from "./providers/TopicDescriptorProvider.ts";
import { TopicProvider } from "./providers/TopicProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$subscriber.ts";
export * from "./descriptors/$topic.ts";
export * from "./errors/TopicTimeoutError.ts";
export * from "./providers/MemoryTopicProvider.ts";
export * from "./providers/TopicDescriptorProvider.ts";
export * from "./providers/TopicProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Alepha Topic Module
 *
 * Generic interface for pub/sub messaging.
 * Gives you the ability to create topics and subscribers.
 * This module provides only a memory implementation of the topic provider.
 *
 * @see {@link $topic}
 * @see {@link $subscriber}
 * @module alepha.topic
 */
export class AlephaTopic implements Module {
	public readonly name = "alepha.topic";
	public readonly $services = (alepha: Alepha) =>
		alepha
			.with({
				provide: TopicProvider,
				use: MemoryTopicProvider,
				optional: true,
			})
			.with(TopicDescriptorProvider);
}

__bind($topic, AlephaTopic);
