import { $module } from "alepha";
import { AlephaLock } from "alepha/lock";
import { CronProvider } from "./providers/CronProvider.ts";
import { WorkerdCronProvider } from "./providers/WorkerdCronProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./constants/CRON.ts";
export * from "./providers/CronProvider.ts";
export * from "./providers/WorkerdCronProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    /**
     * Cloudflare Workers scheduled event.
     *
     * Emitted when a cron trigger fires in Cloudflare Workers.
     */
    "cloudflare:scheduled": {
      cron: string;
      scheduledTime: number;
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Cron tick engine used under `$job`. **Not an application-facing API.**
 *
 * There is no scheduler primitive — declare scheduled work with
 * `$job({ cron })`. On Cloudflare the build emits every registered cron
 * expression into `wrangler.jsonc` as a native Cron Trigger, and the
 * `cloudflare:scheduled` event routes the tick back to the matching job.
 *
 * @module alepha.scheduler
 */
export const AlephaScheduler = $module({
  name: "alepha.scheduler",
  imports: [AlephaLock],
  services: [CronProvider],
  variants: [WorkerdCronProvider],
  register: (alepha) =>
    // Replace CronProvider with WorkerdCronProvider for Cloudflare Workers
    alepha.with({
      provide: CronProvider,
      use: WorkerdCronProvider,
    }),
});
