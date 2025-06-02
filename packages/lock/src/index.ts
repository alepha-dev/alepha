import type { Static } from "@alepha/core";
import { $inject, Alepha, __bind, t } from "@alepha/core";
import { RedisProvider, RedisSubscriberProvider } from "@alepha/redis";
import { MemoryTopicProvider, RedisTopicProvider } from "@alepha/topic";
import { $lock } from "./descriptors/$lock.ts";
import { LockDescriptorProvider } from "./providers/LockDescriptorProvider.ts";
import { LockProvider } from "./providers/LockProvider.ts";
import { LockTopicProvider } from "./providers/LockTopicProvider.ts";
import { MemoryLockProvider } from "./providers/MemoryLockProvider.ts";
import { RedisLockProvider } from "./providers/RedisLockProvider.ts";

export * from "./descriptors/$lock.ts";
export * from "./providers/LockDescriptorProvider.ts";
export * from "./providers/LockProvider.ts";
export * from "./providers/LockTopicProvider.ts";
export * from "./providers/MemoryLockProvider.ts";
export * from "./providers/RedisLockProvider.ts";

const envSchema = t.object({
	LOCK_PROVIDER: t.enum(["memory", "redis"], { default: "memory" }),
});

declare module "@alepha/core" {
	interface Env extends Partial<Static<typeof envSchema>> {}
}

export class LockModule {
	protected readonly alepha = $inject(Alepha);
	protected readonly env = $inject(envSchema);

	constructor() {
		if (this.env.LOCK_PROVIDER === "redis") {
			this.alepha.with(RedisProvider);
			this.alepha.with(RedisSubscriberProvider);
		}

		this.alepha.register({
			default: true,
			provide: LockTopicProvider,
			use: {
				redis: RedisTopicProvider,
				memory: MemoryTopicProvider,
			}[this.env.LOCK_PROVIDER],
		});

		this.alepha.register({
			default: true,
			provide: LockProvider,
			use: {
				redis: RedisLockProvider,
				memory: MemoryLockProvider,
			}[this.env.LOCK_PROVIDER],
		});

		this.alepha.register(LockDescriptorProvider);
	}
}

__bind($lock, LockModule);
