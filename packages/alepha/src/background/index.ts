import { $module } from "alepha";
import { BackgroundTaskProvider } from "./providers/BackgroundTaskProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/BackgroundTaskProvider.ts";
export * from "./providers/WorkerdBackgroundTaskProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Fire-and-forget background work that should outlive the request that
 * scheduled it, without blocking the response.
 *
 * Inject {@link BackgroundTaskProvider} and call `defer(() => …)`:
 *
 * ```ts
 * protected readonly background = $inject(BackgroundTaskProvider);
 *
 * createUser = $action({ handler: async ({ body }) => {
 *   const user = await this.users.create(body);
 *   this.background.defer(() => this.email.send(welcome(user))); // don't block
 *   return user;
 * }});
 * ```
 *
 * On Node/Vercel the event loop keeps the task alive. On Cloudflare Workers the
 * `workerd` build swaps in {@link WorkerdBackgroundTaskProvider}, which wraps
 * the task in `executionCtx.waitUntil` so the isolate isn't frozen at response
 * time - the call site is identical either way.
 *
 * @module alepha.background
 */
export const AlephaBackground = $module({
  name: "alepha.background",
  services: [BackgroundTaskProvider],
});
