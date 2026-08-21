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
 * - `alepha platform secrets`    — manage external secret stores
 *
 * Configuration in `alepha.config.ts`:
 *
 * ```typescript
 * import { platform } from "alepha/cli/platform";
 *
 * export default defineConfig({
 *   plugins: [
 *     platform({
 *       environments: {
 *         production: { adapter: "cloudflare", domain: "myapp.com" },
 *       },
 *     }),
 *   ],
 * });
 * ```
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
  const mode = process.env.NODE_ENV ?? process.env.MODE;
  if (!process.env.PUBLIC_URL && mode === "production") {
    const productionDomain = options?.environments?.production?.domain;
    // A wildcard domain is a routing pattern, not a hostname.
    if (productionDomain && !productionDomain.includes("*")) {
      process.env.PUBLIC_URL = `https://${productionDomain}`;
    }
  }

  return () => {
    const { alepha } = $context();
    alepha.with(AlephaCliPlatformPlugin).set(platformOptions, options);
  };
};

// ---------------------------------------------------------------------------

export * from "./commands/platform.ts";
export * from "./commands/SecretsCommand.ts";
