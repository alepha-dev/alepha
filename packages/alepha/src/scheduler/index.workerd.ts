import { $module } from "alepha";
import { AlephaLock } from "alepha/lock";
import { $scheduler } from "./primitives/$scheduler.ts";
import { CronProvider } from "./providers/CronProvider.ts";
import { WorkerdCronProvider } from "./providers/WorkerdCronProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./constants/CRON.ts";
export * from "./primitives/$scheduler.ts";
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

export const AlephaScheduler = $module({
  name: "alepha.scheduler",
  primitives: [$scheduler],
  services: [AlephaLock, CronProvider, WorkerdCronProvider],
  register: (alepha) => {
    // Replace CronProvider with WorkerdCronProvider for Cloudflare Workers
    alepha.with({
      provide: CronProvider,
      use: WorkerdCronProvider,
    });
  },
});
