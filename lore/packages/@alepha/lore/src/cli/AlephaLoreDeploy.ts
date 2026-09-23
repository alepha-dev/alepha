import { $module } from "alepha";
import { AlephaServerLinksClient } from "alepha/server/links";

import { LoreAdapter } from "./adapters/LoreAdapter.ts";
import { ArtifactUploader } from "./services/ArtifactUploader.ts";
import { GitContextService } from "./services/GitContextService.ts";
import { LoreArtifactPusher } from "./services/LoreArtifactPusher.ts";
import { LoreClientService } from "./services/LoreClientService.ts";
import { LoreDeployer } from "./services/LoreDeployer.ts";
import { LoreDeviceLogin } from "./services/LoreDeviceLogin.ts";
import { LoreProjectResolver } from "./services/LoreProjectResolver.ts";
import { LoreSecretsService } from "./services/LoreSecretsService.ts";
import { LoreTokenStore } from "./services/LoreTokenStore.ts";

/**
 * What a deploy through Lore needs, and not one command.
 *
 * ## ⚠️ Services only, and that is the whole point of this module
 *
 * `Alepha.inject` registers the module that DECLARES a service, through its
 * `[MODULE]` back-reference. When every service here was declared in
 * `AlephaLoreCli`, beside the twelve `lore` commands, anything that injected
 * one - the platform adapter injecting `LoreClientService` from inside the
 * `alepha` binary, say - registered that module whole, and `alepha --help`
 * grew every Lore verb.
 *
 * So what the adapter reaches is declared here, and `AlephaLoreCli` imports
 * this module. `deployModule.spec.ts` injects each service into a bare
 * container and asserts no `$command` came with it, the mirror of
 * `commandSurface.spec.ts`.
 *
 * ⚠️ Nothing added here may inject a command, or a service declared beside
 * commands. That would undo the split silently.
 *
 * @module alepha.lore.deploy
 */
export const AlephaLoreDeploy = $module({
  name: "alepha.lore.deploy",
  imports: [AlephaServerLinksClient],
  services: [
    LoreClientService,
    LoreTokenStore,
    LoreProjectResolver,
    GitContextService,
    ArtifactUploader,
    LoreArtifactPusher,
    LoreDeployer,
    LoreSecretsService,
    LoreDeviceLogin,
    // The platform adapter itself: `platform()` registers it by class, which
    // registers this module, and so none of the `lore` commands.
    LoreAdapter,
  ],
});
