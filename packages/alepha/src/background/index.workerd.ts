import { $module } from "alepha";
import { BackgroundTaskProvider } from "./providers/BackgroundTaskProvider.ts";
import { WorkerdBackgroundTaskProvider } from "./providers/WorkerdBackgroundTaskProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/BackgroundTaskProvider.ts";
export * from "./providers/WorkerdBackgroundTaskProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Cloudflare Workers build of {@link AlephaBackground}: swaps
 * {@link BackgroundTaskProvider} for {@link WorkerdBackgroundTaskProvider},
 * which keeps the isolate alive past the response via `executionCtx.waitUntil`.
 *
 * @module alepha.background
 */
export const AlephaBackground = $module({
  name: "alepha.background",
  services: [BackgroundTaskProvider],
  variants: [WorkerdBackgroundTaskProvider],
  register: (alepha) =>
    alepha.with({
      provide: BackgroundTaskProvider,
      use: WorkerdBackgroundTaskProvider,
    }),
});
