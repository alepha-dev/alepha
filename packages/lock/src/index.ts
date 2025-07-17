import { $module } from "@alepha/core";
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
const AlephaLock = $module({
	name: "alepha.lock",
	descriptors: [$lock],
	services: [
		LockProvider,
		MemoryLockProvider,
		LockTopicProvider,
		LockDescriptorProvider,
	],
	register: (alepha) =>
		alepha
			.with({
				optional: true,
				provide: LockTopicProvider,
				use: MemoryTopicProvider,
			})
			.with({
				optional: true,
				provide: LockProvider,
				use: MemoryLockProvider,
			})
			.with(LockDescriptorProvider),
});

export default AlephaLock;
