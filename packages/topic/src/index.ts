import type { Static } from "@alepha/core";
import { $inject, Alepha, autoInject, t } from "@alepha/core";
import { $topic } from "./descriptors/$topic";
import { MemoryTopicProvider } from "./providers/MemoryTopicProvider";
import { RedisTopicProvider } from "./providers/RedisTopicProvider";
import { TopicDescriptorProvider } from "./providers/TopicDescriptorProvider";
import { TopicProvider } from "./providers/TopicProvider";

export * from "./descriptors/$subscriber";
export * from "./descriptors/$topic";
export * from "./errors/TopicTimeoutError";
export * from "./providers/MemoryTopicProvider";
export * from "./providers/RedisTopicProvider";
export * from "./providers/TopicDescriptorProvider";
export * from "./providers/TopicProvider";

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

autoInject($topic, TopicModule);
