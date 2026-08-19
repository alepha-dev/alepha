import { $module } from "alepha";
import { AlephaLock } from "alepha/lock";
import { CronProvider } from "./providers/CronProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./constants/CRON.ts";
export * from "./providers/CronProvider.ts";
export * from "./providers/WorkerdCronProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    /**
     * Generic serverless cron trigger event.
     *
     * Emitted by serverless platform entry points (Cloudflare scheduled,
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
 * `CronProvider` remains the single registry of cron expressions - the
 * Cloudflare build reads it to emit native platform triggers.
 * Register a cron directly with `CronProvider.createCronJob()` if you need a
 * tick without a database.
 *
 * **Features:**
 * - Cron expression scheduling (e.g., `0 0 * * *`)
 * - Serverless cron dispatch via the `serverless:cron` hook (Cloudflare, generic)
 *
 * For distributed locking and retries around scheduled work, use `$job({ cron })`
 * from `alepha/api/jobs` - it layers durability on top of this scheduler.
 *
 * @module alepha.scheduler
 */
export const AlephaScheduler = $module({
  name: "alepha.scheduler",
  services: [AlephaLock, CronProvider],
});
