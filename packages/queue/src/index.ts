import type { Static } from "@alepha/core";
import { __bind, $inject, Alepha, t } from "@alepha/core";
import { $queue } from "./descriptors/$queue.ts";
import { MemoryQueueProvider } from "./providers/MemoryQueueProvider.ts";
import { QueueDescriptorProvider } from "./providers/QueueDescriptorProvider.ts";
import { QueueProvider } from "./providers/QueueProvider.ts";
import { RedisQueueProvider } from "./providers/RedisQueueProvider.ts";

export * from "./descriptors/$consumer.ts";
export * from "./descriptors/$queue.ts";
export * from "./providers/MemoryQueueProvider.ts";
export * from "./providers/QueueDescriptorProvider.ts";
export * from "./providers/QueueProvider.ts";
export * from "./providers/RedisQueueProvider.ts";

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
		this.alepha.with({
			optional: true,
			provide: QueueProvider,
			use: {
				memory: MemoryQueueProvider,
				redis: RedisQueueProvider,
			}[this.env.QUEUE_PROVIDER],
		});
		this.alepha.with(QueueDescriptorProvider);
	}
}

__bind($queue, QueueModule);
