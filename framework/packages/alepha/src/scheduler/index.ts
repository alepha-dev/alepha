import { $module } from "alepha";

import { CronProvider } from "./providers/CronProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/CronProvider.ts";
export * from "./providers/WorkerdCronProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    /**
     * Generic serverless cron trigger event.
     *
     * Emitted by an app's own serverless entry point to run a registered
     * cron job by name: `CronProvider` listens and calls `trigger(name)`.
     * Nothing in the framework emits it.
     *
     * Cloudflare Workers uses the platform-specific `cloudflare:scheduled`
     * event instead (matched by cron expression), see
     * `WorkerdCronProvider`.
     */
    "serverless:cron:triggered": { name: string };
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
 * `CronProvider` remains the single registry of cron expressions - the
 * Cloudflare build reads it to emit native platform triggers.
 * Register a cron directly with `CronProvider.createCronJob()` if you need a
 * tick without a database.
 *
 * **Features:**
 * - Cron expression scheduling (e.g., `0 0 * * *`)
 * - Serverless cron dispatch: `cloudflare:scheduled` on Cloudflare Workers,
 *   `serverless:cron:triggered` for an app's own entry point elsewhere
 *
 * For distributed locking and retries around scheduled work, use `$job({ cron })`
 * from `alepha/api/jobs` - it layers durability on top of this scheduler.
 *
 * @module alepha.scheduler
 */
export const AlephaScheduler = $module({
  name: "alepha.scheduler",
  services: [CronProvider],
});
