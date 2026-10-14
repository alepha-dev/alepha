/**
 * Explicit infrastructure environments, managed with `alepha infra` and
 * deployed through the full lifecycle with `alepha deploy`. Supports
 * Cloudflare Workers, Bay and external adapters.
 *
 * @module alepha.cli.infra
 */
import { $context, $module } from "alepha";
import { AlephaCli } from "alepha/cli";
import {
  AlephaInfraLibPlugin,
  bay,
  cloudflare,
  type InfraOptions,
  infraOptions,
} from "alepha/cli/infra-lib";

import { AlephaCliInfraCommands } from "./commands.ts";

// ---------------------------------------------------------------------------

/**
 * CLI plugin for multi-cloud deployment orchestration.
 *
 * Wraps `AlephaInfraLibPlugin` (the framework-agnostic deploy
 * services) with `$command` instances so the orchestration is
 * reachable from `alepha infra …`. Non-CLI consumers (e.g. Alepha
 * Rocket) should depend on `alepha/cli/infra-lib` directly instead
 * of pulling in this command surface.
 *
 * Commands:
 * - `alepha infra plan`     -  show project topology and resource names
 * - `alepha deploy`       -  full deployment pipeline
 * - `alepha infra down`     -  teardown an environment
 * - `alepha infra status`   -  inspect deployed resources
 * - `alepha infra build`    -  build apps locally
 * - `alepha infra deploy`      -  deploy to cloud
 * - `alepha infra db migrate`  -  run database migrations
 * - `alepha infra db export`   -  pull the deployed DB into a local snapshot
 * - `alepha infra db baseline mark`  -  mark a baseline on the deployed DB
 * - `alepha infra secrets`     -  manage external secret stores
 * - `alepha infra login|logout`  -  manage the stored provider token
 *
 * Configuration in `alepha.config.ts`:
 *
 * ```typescript
 * import { defineConfig } from "alepha/cli/config";
 * import { bay, cloudflare, infra } from "alepha/cli/infra";
 *
 * export default defineConfig({
 *   plugins: [
 *     infra({
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
export const AlephaCliInfraPlugin = $module({
  name: "alepha.cli.infra",
  imports: [AlephaCli, AlephaInfraLibPlugin, AlephaCliInfraCommands],
});

export const infra = (options: InfraOptions) => {
  // When a `production` environment with a `domain` is configured, default
  // `process.env.PUBLIC_URL` to `https://<domain>` if the host hasn't set
  // it already. Lets app code render absolute links (emails, OAuth
  // callbacks, etc.) without restating the production hostname in two
  // places. Honors an explicit env override and any non-production-only
  // setup (we don't override prod-set values).
  // Only in production. This runs at config IMPORT time, so without the mode
  // gate a plain `alepha dev` inherited the production hostname and every
  // absolute link it rendered  -  OAuth callbacks, email links  -  pointed at
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
    alepha.with(AlephaCliInfraPlugin).set(infraOptions, options);
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

export * from "./commands/infra.ts";
export * from "./commands/SecretsCommand.ts";

/**
 * Shared command module loaded by the Node CLI during configuration.
 *
 * @internal
 */
export { AlephaCliInfraCommands };
