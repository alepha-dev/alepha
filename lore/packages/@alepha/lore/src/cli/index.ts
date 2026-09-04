import { $module } from "alepha";
import { AlephaServerLinksClient } from "alepha/server/links";

import { ArtifactCommand } from "./commands/ArtifactCommand.ts";
import { LoginCommand } from "./commands/LoginCommand.ts";
import { QualityCommand } from "./commands/QualityCommand.ts";
import { ReleaseCommand } from "./commands/ReleaseCommand.ts";
import { ArtifactUploader } from "./services/ArtifactUploader.ts";
import { GitContextService } from "./services/GitContextService.ts";
import { LoreClientService } from "./services/LoreClientService.ts";
import { LoreProjectResolver } from "./services/LoreProjectResolver.ts";
import { LoreTokenStore } from "./services/LoreTokenStore.ts";
import { QualityReportReader } from "./services/QualityReportReader.ts";

// ---------------------------------------------------------------------------

/**
 * What the `lore` binary is made of.
 *
 * The other half of this package reports from a running app; this half is what
 * a pipeline runs. It lives here rather than in `alepha/cli` because Lore is a
 * superset of Alepha and no Lore code belongs inside the framework, and it is
 * a subpath rather than a package of its own so that both halves share one
 * answer to "where is Lore, and how do I authenticate to it".
 *
 * ```bash
 * npm i -g "@alepha/lore"
 * lore login
 * lore quality push -p alepha
 * ```
 *
 * ## ⚠️ Five top-level commands, and no root of its own
 *
 * `quality`, `artifacts`, `releases`, `login` and `logout` register at the top
 * level, because the binary IS the root. A `lore` command inside a `lore`
 * binary reads `lore lore quality push`.
 *
 * That also means nothing here may inject a command from `alepha/cli`:
 * `Alepha.inject` registers the module that declares a service, so one such
 * injection would hand this container every Alepha CLI command under a second
 * name. `commandSurface.spec.ts` is what keeps that true.
 *
 * The project comes from `-p`, and the secret from `LORE_API_KEY`. No
 * credential ever lands in a committed file.
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
export const AlephaLoreCli = $module({
  name: "alepha.lore.cli",
  imports: [AlephaServerLinksClient],
  services: [
    LoreClientService,
    QualityReportReader,
    GitContextService,
    ArtifactUploader,
    LoreTokenStore,
    // ⚠️ None of the five below is re-exported. Each names, directly or
    // through what it injects, a type from the private `lore` workspace, and
    // an exported signature carrying one would put that workspace in the
    // published `.d.ts`. `scripts/check-dts.ts` fails the build if it does.
    LoreProjectResolver,
    QualityCommand,
    ArtifactCommand,
    ReleaseCommand,
    LoginCommand,
  ],
});

// ---------------------------------------------------------------------------

export * from "./services/GitContextService.ts";
export * from "./services/LoreClientService.ts";
export * from "./services/LoreTokenStore.ts";
export * from "./services/QualityReportReader.ts";
