import { $inject, Alepha, autoInject } from "@alepha/core";
import { $topic } from "./descriptors/$topic";
import { MemoryTopicProvider } from "./providers/MemoryTopicProvider";
import { TopicDescriptorProvider } from "./providers/TopicDescriptorProvider";
import { TopicProvider } from "./providers/TopicProvider";

export * from "./descriptors/$subscriber";
export * from "./descriptors/$topic";
export * from "./errors/TopicTimeoutError";
export * from "./providers/MemoryTopicProvider";
export * from "./providers/TopicDescriptorProvider";
export * from "./providers/TopicProvider";

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

autoInject($topic, TopicModule);
