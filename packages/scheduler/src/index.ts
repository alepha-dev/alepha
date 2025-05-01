import { $inject, Alepha, autoInject } from "@alepha/core";
import { $scheduler } from "./descriptors/$scheduler";
import { SchedulerDescriptorProvider } from "./providers/SchedulerDescriptorProvider";

export * from "./descriptors/$scheduler";
export * from "./providers/SchedulerDescriptorProvider";

export class SchedulerModule {
	protected readonly alepha = $inject(Alepha);

	constructor() {
		this.alepha.register(SchedulerDescriptorProvider);
	}
}

autoInject($scheduler, SchedulerModule);
