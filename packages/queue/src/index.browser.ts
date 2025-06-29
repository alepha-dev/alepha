import { $inject, Alepha } from "@alepha/core";
import { MemoryQueueProvider } from "./providers/MemoryQueueProvider.ts";
import { QueueDescriptorProvider } from "./providers/QueueDescriptorProvider.ts";
import { QueueProvider } from "./providers/QueueProvider.ts";

export class QueueModule {
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha.with({
			optional: true,
			provide: QueueProvider,
			use: MemoryQueueProvider,
		});

		this.alepha.with(QueueDescriptorProvider);
	}
}
