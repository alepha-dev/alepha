import type { Static } from "@alepha/core";
import { $inject, Alepha, autoInject, t } from "@alepha/core";
import { MemoryTopicProvider, RedisTopicProvider } from "@alepha/topic";
import { $lock } from "./descriptors/$lock";
import { LockDescriptorProvider } from "./providers/LockDescriptorProvider";
import { LockProvider } from "./providers/LockProvider";
import { LockTopicProvider } from "./providers/LockTopicProvider";
import { MemoryLockProvider } from "./providers/MemoryLockProvider";
import { RedisLockProvider } from "./providers/RedisLockProvider";

export * from "./descriptors/$lock";
export * from "./providers/LockDescriptorProvider";
export * from "./providers/LockProvider";
export * from "./providers/LockTopicProvider";
export * from "./providers/MemoryLockProvider";
export * from "./providers/RedisLockProvider";

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

autoInject($lock, LockModule);
