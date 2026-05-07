import { $module } from "alepha";
import type { DateTime } from "alepha/datetime";
import { AlephaLock } from "alepha/lock";
import { $scheduler } from "./primitives/$scheduler.ts";
import { CronProvider } from "./providers/CronProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./constants/CRON.ts";
export * from "./primitives/$scheduler.ts";
export * from "./providers/CronProvider.ts";
export * from "./providers/WorkerdCronProvider.ts";

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

    /**
     * Generic serverless cron trigger event.
     *
     * Emitted by serverless platform entry points (Vercel `/api/cron/...`,
     * etc.) to trigger a registered cron job by name. `CronProvider`
     * listens to this and calls `trigger(name)` so the same `$scheduler`
     * / `$job({ cron })` declarations work across runtimes.
     *
     * Cloudflare Workers uses the platform-specific `cloudflare:scheduled`
     * event instead (matched by cron expression), see
     * `WorkerdCronProvider`.
     */
    "serverless:cron": { name: string };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
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
