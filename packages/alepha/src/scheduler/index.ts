import { $module } from "alepha";
import type { DateTime } from "alepha/datetime";
import { AlephaLock } from "alepha/lock";
import { $scheduler } from "./primitives/$scheduler.ts";
import { CronProvider } from "./providers/CronProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./constants/CRON.ts";
export * from "./primitives/$scheduler.ts";
export * from "./providers/CronProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
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
 * | type | quality | stability |
 * |------|---------|-----------|
 * | backend | rare | stable |
 *
 * Cron and interval-based task execution.
 *
 * **Features:**
 * - Scheduled tasks with cron expressions (e.g., `0 0 * * *`)
 * - Interval-based scheduling
 * - Distributed locking to prevent duplicate execution
 * - Lifecycle hooks: `begin`, `success`, `error`, `end`
 *
 * @module alepha.scheduler
 */
export const AlephaScheduler = $module({
  name: "alepha.scheduler",
  primitives: [$scheduler],
  services: [AlephaLock, CronProvider],
});
