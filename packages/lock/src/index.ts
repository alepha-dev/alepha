import { __bind, type Alepha } from "@alepha/core";
import { MemoryTopicProvider } from "@alepha/topic";
import { $lock } from "./descriptors/$lock.ts";
import { LockDescriptorProvider } from "./providers/LockDescriptorProvider.ts";
import { LockProvider } from "./providers/LockProvider.ts";
import { LockTopicProvider } from "./providers/LockTopicProvider.ts";
import { MemoryLockProvider } from "./providers/MemoryLockProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$lock.ts";
export * from "./providers/LockDescriptorProvider.ts";
export * from "./providers/LockProvider.ts";
export * from "./providers/LockTopicProvider.ts";
export * from "./providers/MemoryLockProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Lock a resource for a certain period of time.
 *
 * This module provides a memory implementation of the lock provider.
 * You probably want to use an implementation like RedisLockProvider for distributed systems.
 *
 * @see {@link $lock}
 * @module alepha.lock
 */
export class AlephaLock {
	public readonly name = "alepha.lock";
	public readonly $services = (alepha: Alepha): Alepha =>
		alepha
			.with({
				provide: LockTopicProvider,
				use: MemoryTopicProvider,
				optional: true,
			})
			.with({
				provide: LockProvider,
				use: MemoryLockProvider,
				optional: true,
			})
			.with(LockDescriptorProvider);
}

__bind($lock, AlephaLock);
