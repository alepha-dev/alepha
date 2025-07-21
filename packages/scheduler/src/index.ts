import { $module } from "@alepha/core";
import { AlephaLock } from "@alepha/lock";
import { $scheduler } from "./descriptors/$scheduler.ts";
import { CronProvider } from "./providers/CronProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$scheduler.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Generic interface for scheduling tasks.
 *
 * @see {@link $scheduler}
 * @module alepha.scheduler
 */
export const AlephaScheduler = $module({
	name: "alepha.scheduler",
	descriptors: [$scheduler],
	services: [AlephaLock, CronProvider],
});
