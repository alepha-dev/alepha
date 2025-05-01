import type { Static } from "@alepha/core";
import { $inject, Alepha, autoInject, t } from "@alepha/core";
import { $queue } from "./descriptors/$queue";
import { MemoryQueueProvider } from "./providers/MemoryQueueProvider";
import { QueueDescriptorProvider } from "./providers/QueueDescriptorProvider";
import { QueueProvider } from "./providers/QueueProvider";
import { RedisQueueProvider } from "./providers/RedisQueueProvider";

export * from "./descriptors/$consumer";
export * from "./descriptors/$queue";
export * from "./providers/MemoryQueueProvider";
export * from "./providers/QueueDescriptorProvider";
export * from "./providers/QueueProvider";
export * from "./providers/RedisQueueProvider";

const envSchema = t.object({
	QUEUE_PROVIDER: t.enum(["memory", "redis"], { default: "memory" }),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class QueueModule {
	protected readonly alepha = $inject(Alepha);
	protected readonly env = $inject(envSchema);

	constructor() {
		this.alepha.register(QueueDescriptorProvider);
		this.alepha.register({
			default: true,
			provide: QueueProvider,
			use: {
				memory: MemoryQueueProvider,
				redis: RedisQueueProvider,
			}[this.env.QUEUE_PROVIDER],
		});
	}
}

autoInject($queue, QueueModule);
