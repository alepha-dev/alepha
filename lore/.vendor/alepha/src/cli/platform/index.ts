/**
 * The `alepha platform` plugin (`alepha p`): plan, provision, build, migrate,
 * deploy and tear down named environments on Cloudflare Workers or Bay, plus
 * `secrets` and `auth` management.
 *
 * @module alepha.cli.platform
 */
import { $context, $module } from "alepha";
import { AlephaCli } from "alepha/cli";
import {
  AlephaPlatformLibPlugin,
  bay,
  cloudflare,
  type PlatformOptions,
  platformOptions,
} from "alepha/cli/platform-lib";

import { PlatformCommand } from "./commands/platform.ts";
import { SecretsCommand } from "./commands/SecretsCommand.ts";

// ---------------------------------------------------------------------------

/**
 * CLI plugin for multi-cloud deployment orchestration.
 *
 * Wraps `AlephaPlatformLibPlugin` (the framework-agnostic deploy
 * services) with `$command` instances so the orchestration is
 * reachable from `alepha platform …`. Non-CLI consumers (e.g. Alepha
 * Rocket) should depend on `alepha/cli/platform-lib` directly instead
 * of pulling in this command surface.
 *
 * Commands:
 * - `alepha platform plan`    — show project topology and resource names
 * - `alepha platform up`      — full deployment pipeline
 * - `alepha platform down`    — teardown an environment
 * - `alepha platform status`  — inspect deployed resources
 * - `alepha platform build`   — build apps locally
 * - `alepha platform deploy`     — deploy to cloud
 * - `alepha platform db migrate` — run database migrations
 * - `alepha platform db export`  — pull the deployed DB into a local snapshot
 * - `alepha platform db baseline mark` — mark a baseline on the deployed DB
 * - `alepha platform secrets`    — manage external secret stores
 * - `alepha platform auth login|logout` — manage the stored provider token
 *
 * Configuration in `alepha.config.ts`:
 *
 * ```typescript
 * import { bay, cloudflare, platform } from "alepha/cli/platform";
 *
 * export default defineConfig({
 *   plugins: [
 *     platform({
 *       name: "myapp", // the APP name; defaults to package.json "name"
 *       environments: {
 *         production: cloudflare({ domain: "myapp.com" }),
 *         edge: bay({ host: "deploy@bay.example.com" }),
 *       },
 *     }),
 *   ],
 * });
 * ```
 *
 * An environment names its adapter by importing a factory, so an adapter
 * that lives outside the framework is just another import (`lore()` from
 * `@alepha/lore/cli`).
 */
export const AlephaCliPlatformPlugin = $module({
  name: "alepha.cli.plugins.platform",
  services: [
    AlephaCli,
    AlephaPlatformLibPlugin,
    PlatformCommand,
    SecretsCommand,
  ],
});

export const platform = (options: PlatformOptions) => {
  // When a `production` environment with a `domain` is configured, default
  // `process.env.PUBLIC_URL` to `https://<domain>` if the host hasn't set
  // it already. Lets app code render absolute links (emails, OAuth
  // callbacks, etc.) without restating the production hostname in two
  // places. Honors an explicit env override and any non-production-only
  // setup (we don't override prod-set values).
  // Only in production. This runs at config IMPORT time, so without the mode
  // gate a plain `alepha dev` inherited the production hostname and every
  // absolute link it rendered — OAuth callbacks, email links — pointed at
  // prod from a dev session.
  //
  // Read structurally: `domain` is on the options of the adapters that attach
  // a host, and an environment from another factory (`lore()`) has none.
  const mode = process.env.NODE_ENV ?? process.env.MODE;
  if (!process.env.PUBLIC_URL && mode === "production") {
    const productionDomain = (
      options?.environments?.production?.options as
        | { domain?: unknown }
        | undefined
    )?.domain;
    if (typeof productionDomain === "string" && productionDomain) {
      process.env.PUBLIC_URL = `https://${productionDomain}`;
    }
  }

  return () => {
    const { alepha } = $context();
    alepha.with(AlephaCliPlatformPlugin).set(platformOptions, options);
    // ⚠️ At configure time, not when an environment is resolved: `inject`
    // after `start()` refuses a service whose module was never registered.
    // Registering the class is also what brings a third-party adapter's
    // `$module`, and every service it declares, into the container.
    for (const descriptor of Object.values(options?.environments ?? {})) {
      alepha.with(descriptor.adapter);
    }
  };
};

// ---------------------------------------------------------------------------

// Re-exported so an `alepha.config.ts` needs one import for the plugin and
// the built-in adapters it names.
export { bay, cloudflare };

export * from "./commands/platform.ts";
export * from "./commands/SecretsCommand.ts";
