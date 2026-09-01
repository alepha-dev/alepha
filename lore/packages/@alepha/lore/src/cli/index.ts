import { $context, $module } from "alepha";
import { AlephaServerLinksClient } from "alepha/server/links";

import { type LoreOptions, loreOptions } from "./atoms/loreOptions.ts";
import { ArtifactCommand } from "./commands/ArtifactCommand.ts";
import { LoreCommand } from "./commands/LoreCommand.ts";
import { QualityCommand } from "./commands/QualityCommand.ts";
import { ArtifactUploader } from "./services/ArtifactUploader.ts";
import { GitContextService } from "./services/GitContextService.ts";
import { LoreClientService } from "./services/LoreClientService.ts";
import { LoreProjectResolver } from "./services/LoreProjectResolver.ts";
import { QualityReportReader } from "./services/QualityReportReader.ts";

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
  services: [
    LoreClientService,
    QualityReportReader,
    GitContextService,
    ArtifactUploader,
    // ⚠️ None of the four below is re-exported. Each names, directly or
    // through what it injects, a type from the private `lore` workspace, and
    // an exported signature carrying one would put that workspace in the
    // published `.d.ts`. `scripts/check-dts.mjs` fails the build if it does.
    LoreProjectResolver,
    QualityCommand,
    ArtifactCommand,
    // The `lore` root, and the only declaration of it. Two classes declaring
    // it would not collide - `findCommand` resolves by `findLast`, so the
    // second would silently shadow the first and take its subtree with it.
    LoreCommand,
  ],
});

export const lore = (options: LoreOptions = {}) => {
  return () => {
    const { alepha } = $context();
    alepha.with(AlephaLoreCliPlugin).set(loreOptions, options);
  };
};

// ---------------------------------------------------------------------------

export * from "./atoms/loreOptions.ts";
export * from "./services/GitContextService.ts";
export * from "./services/LoreClientService.ts";
export * from "./services/QualityReportReader.ts";
