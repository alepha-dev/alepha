import type { Alepha } from "@alepha/core";
import { LockProvider, LockTopicProvider } from "@alepha/lock";
import { RedisTopicProvider } from "@alepha/topic-redis";
import { RedisLockProvider } from "./providers/RedisLockProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/RedisLockProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Alepha Lock Redis Module
 *
 * Plugin for Alepha that provides a locking mechanism.
 *
 * @see {@link RedisLockProvider}
 * @module alepha.lock.redis
 */
export class AlephaLock {
	public readonly name = "alepha.lock.redis";
	public readonly $services = (alepha: Alepha) =>
		alepha
			.with({
				provide: LockTopicProvider,
				use: RedisTopicProvider,
				optional: true,
			})
			.with({
				provide: LockProvider,
				use: RedisLockProvider,
				optional: true,
			})
			.with(AlephaLock);
}
