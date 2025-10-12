import { $module } from "@alepha/core";
import type { DateTime } from "@alepha/datetime";
import { AlephaLock } from "@alepha/lock";
import { $scheduler } from "./descriptors/$scheduler.ts";
import { CronProvider } from "./providers/CronProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$scheduler.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "@alepha/core" {
	interface Hooks {
		"scheduler:begin": {
			name: string;
			now: DateTime;
			context: string;
		};

		"scheduler:success": { name: string; context: string };

		"scheduler:error": {
			name: string;
			error: Error;
			context: string;
		};

		"scheduler:end": { name: string; context: string };
	}
}

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
