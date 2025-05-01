import { $inject, Alepha, autoInject } from "@alepha/core";
import { MemoryTopicProvider } from "@alepha/topic";
import { $lock } from "./descriptors/$lock";
import { LockDescriptorProvider } from "./providers/LockDescriptorProvider";
import { LockProvider } from "./providers/LockProvider";
import { LockTopicProvider } from "./providers/LockTopicProvider";
import { MemoryLockProvider } from "./providers/MemoryLockProvider";

export * from "./descriptors/$lock";
export * from "./providers/LockDescriptorProvider";
export * from "./providers/LockProvider";
export * from "./providers/LockTopicProvider";
export * from "./providers/MemoryLockProvider";

export class LockModule {
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha.register({
			default: true,
			provide: LockTopicProvider,
			use: MemoryTopicProvider,
		});

		this.alepha.register({
			default: true,
			provide: LockProvider,
			use: MemoryLockProvider,
		});

		this.alepha.register(LockDescriptorProvider);
	}
}

autoInject($lock, LockModule);
