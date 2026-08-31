import { $context, $module } from "alepha";
import { AlephaServerLinksClient } from "alepha/server/links";

import { type LoreOptions, loreOptions } from "./atoms/loreOptions.ts";
import { LoreClientService } from "./services/LoreClientService.ts";

// ---------------------------------------------------------------------------

/**
 * CLI plugin for talking to a Lore instance from a build or a CI job.
 *
 * The other half of this package reports from a running app; this half is what
 * a pipeline runs. It lives here rather than in `alepha/cli` because Lore is a
 * superset of Alepha and no Lore code belongs inside the framework, and it is
 * a subpath rather than a package of its own so that both halves share one
 * answer to "where is Lore, and how do I authenticate to it".
 *
 * Registered from `alepha.config.ts`, the same way `alepha/cli/vendor` is:
 *
 * ```typescript
 * import { lore } from "@alepha/lore/cli";
 *
 * export default defineConfig({
 *   plugins: [lore({ project: "alepha" })],
 * });
 * ```
 *
 * Config carries the project, env carries the secret (`LORE_API_KEY`), and
 * `--project` overrides the config for one invocation. No credential ever
 * lands in a committed file.
 *
 * ## Why `AlephaServerLinksClient` and not `AlephaServer`
 *
 * `$client` resolves an action against a registry, and in a CLI that registry
 * has to be fetched from the remote. `AlephaServerLinksClient` carries the
 * primitive and the provider that fetches it, and nothing that serves:
 * registering `AlephaServer` here would give a command-line tool an HTTP
 * listener that binds a port.
 *
 * ⚠️ This subpath carries no `browser` export condition, on purpose. A bundler
 * that resolves it has wandered somewhere it does not belong, and should fail
 * on the first `node:` import rather than be handed a stub.
 *
 * @module alepha.lore.cli
 */
export const AlephaLoreCliPlugin = $module({
  name: "alepha.lore.cli",
  imports: [AlephaServerLinksClient],
  atoms: [loreOptions],
  services: [LoreClientService],
});

export const lore = (options: LoreOptions = {}) => {
  return () => {
    const { alepha } = $context();
    alepha.with(AlephaLoreCliPlugin).set(loreOptions, options);
  };
};

// ---------------------------------------------------------------------------

export * from "./atoms/loreOptions.ts";
export * from "./services/LoreClientService.ts";
