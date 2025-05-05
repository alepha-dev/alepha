import type { Static } from "@alepha/core";
import { $inject, Alepha, __bind, t } from "@alepha/core";
import { $topic } from "./descriptors/$topic.ts";
import { MemoryTopicProvider } from "./providers/MemoryTopicProvider.ts";
import { RedisTopicProvider } from "./providers/RedisTopicProvider.ts";
import { TopicDescriptorProvider } from "./providers/TopicDescriptorProvider.ts";
import { TopicProvider } from "./providers/TopicProvider.ts";

export * from "./descriptors/$subscriber.ts";
export * from "./descriptors/$topic.ts";
export * from "./errors/TopicTimeoutError.ts";
export * from "./providers/MemoryTopicProvider.ts";
export * from "./providers/RedisTopicProvider.ts";
export * from "./providers/TopicDescriptorProvider.ts";
export * from "./providers/TopicProvider.ts";

const envSchema = t.object({
	TOPIC_PROVIDER: t.enum(["memory", "redis"], { default: "memory" }),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class TopicModule {
	protected readonly alepha = $inject(Alepha);
	protected readonly env = $inject(envSchema);

	constructor() {
		this.alepha.register({
			default: true,
			provide: TopicProvider,
			use: {
				memory: MemoryTopicProvider,
				redis: RedisTopicProvider,
			}[this.env.TOPIC_PROVIDER],
		});
		this.alepha.register(TopicDescriptorProvider);
	}
}

__bind($topic, TopicModule);
