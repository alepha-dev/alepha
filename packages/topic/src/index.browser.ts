import { $inject, Alepha, __bind } from "@alepha/core";
import { $topic } from "./descriptors/$topic.ts";
import { MemoryTopicProvider } from "./providers/MemoryTopicProvider.ts";
import { TopicDescriptorProvider } from "./providers/TopicDescriptorProvider.ts";
import { TopicProvider } from "./providers/TopicProvider.ts";

export * from "./descriptors/$subscriber.ts";
export * from "./descriptors/$topic.ts";
export * from "./errors/TopicTimeoutError.ts";
export * from "./providers/MemoryTopicProvider.ts";
export * from "./providers/TopicDescriptorProvider.ts";
export * from "./providers/TopicProvider.ts";

export class TopicModule {
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha.register({
			default: true,
			provide: TopicProvider,
			use: MemoryTopicProvider,
		});

		this.alepha.register(TopicDescriptorProvider);
	}
}

__bind($topic, TopicModule);
