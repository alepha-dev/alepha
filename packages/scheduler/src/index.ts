import { __bind, type Alepha } from "@alepha/core";
import AlephaLock from "@alepha/lock";
import { $scheduler } from "./descriptors/$scheduler.ts";
import { SchedulerDescriptorProvider } from "./providers/SchedulerDescriptorProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$scheduler.ts";
export * from "./providers/SchedulerDescriptorProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Generic interface for scheduling tasks.
 *
 * @see {@link $scheduler}
 * @module alepha.scheduler
 */
export class AlephaScheduler {
	public readonly name = "alepha.scheduler";
	public readonly $services = (alepha: Alepha) =>
		alepha.with(SchedulerDescriptorProvider).with(AlephaLock);
}

__bind($scheduler, AlephaScheduler);
