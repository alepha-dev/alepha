import type { RunnerMethod } from "alepha/command";
import type { PlatformContext } from "../adapters/PlatformAdapter.ts";

/**
 * Context passed to platform hooks.
 *
 * Extends PlatformContext with the fully-qualified base URL of the
 * deployed app (derived from `envConfig.domain` or the adapter's deploy
 * URL) and the active RunnerMethod.
 */
export interface PlatformHookContext extends PlatformContext {
  /**
   * Fully-qualified base URL of the deployed app, e.g. "https://foo.com".
   */
  baseUrl: string;
  run: RunnerMethod;
}

/**
 * Third-party provisioning hook for `alepha platform up` / `down`.
 *
 * Plugins can extend this to register resources in external services
 * (Stripe webhooks, Sentry projects, Resend domains, etc.) tied to a
 * deployment. Hooks are discovered via `alepha.services(PlatformHook)`,
 * so adding a plugin to `services: [...]` in `alepha.config.ts` is all
 * it takes to wire one in.
 *
 * Lifecycle:
 * - `register` runs after `deploy` and before `adapter.secrets()` so
 *   any secret a hook writes to `.env.<env>` is picked up in the same
 *   `up` cycle.
 * - `unregister` runs on `down` before `adapter.teardown()`.
 *
 * Implementations MUST be idempotent: `register` is called on every `up`.
 */
export abstract class PlatformHook {
  /**
   * Stable identifier. Used for log output.
   */
  abstract readonly name: string;

  /**
   * Create or update external resources. Must tolerate pre-existing state.
   */
  abstract register(ctx: PlatformHookContext): Promise<void>;

  /**
   * Remove external resources. Must tolerate missing state.
   */
  abstract unregister(ctx: PlatformHookContext): Promise<void>;
}
