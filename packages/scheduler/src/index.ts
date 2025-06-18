import { __bind, $inject, Alepha } from "@alepha/core";
import { $scheduler } from "./descriptors/$scheduler.ts";
import { SchedulerDescriptorProvider } from "./providers/SchedulerDescriptorProvider.ts";

export * from "./descriptors/$scheduler.ts";
export * from "./providers/SchedulerDescriptorProvider.ts";

export class SchedulerModule {
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha.register(SchedulerDescriptorProvider);
	}
}

__bind($scheduler, SchedulerModule);
