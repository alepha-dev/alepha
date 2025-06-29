import { __bind, $inject, Alepha } from "@alepha/core";
import { MemoryTopicProvider } from "@alepha/topic";
import { $lock } from "./descriptors/$lock.ts";
import { LockDescriptorProvider } from "./providers/LockDescriptorProvider.ts";
import { LockProvider } from "./providers/LockProvider.ts";
import { LockTopicProvider } from "./providers/LockTopicProvider.ts";
import { MemoryLockProvider } from "./providers/MemoryLockProvider.ts";

export * from "./descriptors/$lock.ts";
export * from "./providers/LockDescriptorProvider.ts";
export * from "./providers/LockProvider.ts";
export * from "./providers/LockTopicProvider.ts";
export * from "./providers/MemoryLockProvider.ts";

export class LockModule {
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha.with({
			optional: true,
			provide: LockTopicProvider,
			use: MemoryTopicProvider,
		});

		this.alepha.with({
			optional: true,
			provide: LockProvider,
			use: MemoryLockProvider,
		});

		this.alepha.with(LockDescriptorProvider);
	}
}

__bind($lock, LockModule);
