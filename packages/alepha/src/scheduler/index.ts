import { $module } from "alepha";
import type { DateTime } from "alepha/datetime";
import { AlephaLock } from "alepha/lock";
import { CronProvider } from "./providers/CronProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./constants/CRON.ts";
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
     * listens to this and calls `trigger(name)` so the same
     * `$job({ cron })` declarations work across runtimes.
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
 * Cron tick engine used under `$job`. **Not an application-facing API.**
 *
 * There is no scheduler primitive. Declare scheduled work with
 * `$job({ cron })` (`alepha/api/jobs`), which registers here and adds the
 * things a bare tick lacks: run history, retries, timeouts and an admin view.
 *
 * `CronProvider` remains the single registry of cron expressions — the
 * Cloudflare and Vercel builds read it to emit native platform triggers.
 * Register a cron directly with `CronProvider.createCronJob()` if you need a
 * tick without a database.
 *
 * **Features:**
 * - Cron expression scheduling (e.g., `0 0 * * *`)
 * - Distributed locking to prevent duplicate execution across replicas
 * - Lifecycle hooks: `begin`, `success`, `error`, `end`
 *
 * @module alepha.scheduler
 */
export const AlephaScheduler = $module({
  name: "alepha.scheduler",
  services: [AlephaLock, CronProvider],
});
