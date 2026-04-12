import { $module } from "alepha";
import { StripePlatformHook } from "./StripePlatformHook.ts";

export * from "./StripePlatformHook.ts";

/**
 * CLI plugin that auto-provisions the Stripe webhook endpoint during
 * `alepha platform up` / `down`.
 *
 * Usage in `alepha.config.ts`:
 *
 * ```typescript
 * import { AlephaCliPlatformPlugin } from "alepha/cli/platform";
 * import { AlephaCliPlatformStripePlugin } from "@alepha/payments-stripe/platform";
 *
 * export default defineConfig({
 *   services: [AlephaCliPlatformPlugin, AlephaCliPlatformStripePlugin],
 *   platform: { ... },
 * });
 * ```
 *
 * Requires `STRIPE_SECRET_KEY` in `.env.<env>` or `process.env`. Writes
 * the generated `STRIPE_WEBHOOK_SECRET` back to `.env.<env>` so it gets
 * pushed to the worker by the orchestrator's secrets step.
 */
export const AlephaCliPlatformStripePlugin = $module({
  name: "alepha.cli.plugins.platform.stripe",
  services: [StripePlatformHook],
});
