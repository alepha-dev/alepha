import { $module, type Alepha } from "@alepha/core";
import { $subscriber } from "./descriptors/$subscriber.ts";
import { $topic } from "./descriptors/$topic.ts";
import { MemoryTopicProvider } from "./providers/MemoryTopicProvider.ts";
import { TopicProvider } from "./providers/TopicProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$subscriber.ts";
export * from "./descriptors/$topic.ts";
export * from "./errors/TopicTimeoutError.ts";
export * from "./providers/MemoryTopicProvider.ts";
export * from "./providers/TopicProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Generic interface for pub/sub messaging.
 * Gives you the ability to create topics and subscribers.
 * This module provides only a memory implementation of the topic provider.
 *
 * @see {@link $topic}
 * @see {@link $subscriber}
 * @module alepha.topic
 */
export const AlephaTopic = $module({
	name: "alepha.topic",
	descriptors: [$topic, $subscriber],
	services: [TopicProvider, MemoryTopicProvider],
	register: (alepha: Alepha) =>
		alepha.with({
			optional: true,
			provide: TopicProvider,
			use: MemoryTopicProvider,
		}),
});
