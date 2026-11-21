import { $module } from "alepha";

import { CronProvider } from "./providers/CronProvider.ts";
import { WorkerdCronProvider } from "./providers/WorkerdCronProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/CronProvider.ts";
export * from "./providers/WorkerdCronProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Cron tick engine used under `$job`. **Not an application-facing API.**
 *
 * There is no scheduler primitive: declare scheduled work with
 * `$job({ cron })`. On Cloudflare the build emits every registered cron
 * expression into `wrangler.jsonc` as a native Cron Trigger, and the
 * `cloudflare:scheduled` event routes the tick back to the matching job.
 *
 * @module alepha.scheduler
 */
export const AlephaScheduler = $module({
  name: "alepha.scheduler",
  services: [CronProvider],
  variants: [WorkerdCronProvider],
  register: (alepha) =>
    // Replace CronProvider with WorkerdCronProvider for Cloudflare Workers
    alepha.with({
      provide: CronProvider,
      use: WorkerdCronProvider,
    }),
});
