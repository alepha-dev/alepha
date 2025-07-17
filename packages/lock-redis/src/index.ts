import { $module, type Alepha, type ModuleDescriptor } from "@alepha/core";
import AlephaLock, { LockProvider, LockTopicProvider } from "@alepha/lock";
import { RedisTopicProvider } from "@alepha/topic-redis";
import { RedisLockProvider } from "./providers/RedisLockProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/RedisLockProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Plugin for Alepha that provides a locking mechanism.
 *
 * @see {@link RedisLockProvider}
 * @module alepha.lock.redis
 */
export const AlephaLockRedis: ModuleDescriptor = $module({
	name: "alepha.lock.redis",
	services: [RedisLockProvider, RedisTopicProvider],
	register: (alepha: Alepha): Alepha =>
		alepha
			.with({
				optional: true,
				provide: LockTopicProvider,
				use: RedisTopicProvider,
			})
			.with({
				optional: true,
				provide: LockProvider,
				use: RedisLockProvider,
			})
			.with(AlephaLock),
});
