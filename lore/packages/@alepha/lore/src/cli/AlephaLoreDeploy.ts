import { $module } from "alepha";
import { httpClientOptions } from "alepha/server";
import { AlephaServerLinksClient } from "alepha/server/links";

import { LoreAdapter } from "./adapters/LoreAdapter.ts";
import { ArtifactUploader } from "./services/ArtifactUploader.ts";
import { GitContextService } from "./services/GitContextService.ts";
import { GitQuestHistory } from "./services/GitQuestHistory.ts";
import { LoreArtifactPusher } from "./services/LoreArtifactPusher.ts";
import { LoreClientService } from "./services/LoreClientService.ts";
import { LoreDeployer } from "./services/LoreDeployer.ts";
import { LoreDeviceLogin } from "./services/LoreDeviceLogin.ts";
import { LoreProjectLink } from "./services/LoreProjectLink.ts";
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
 * one - the infra adapter injecting `LoreClientService` from inside the
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
/**
 * How many times the `lore` CLI sends a read again when no HTTP answer came
 * back. With the client's own backoff that is up to 3.5 s of patience.
 */
const LORE_NETWORK_RETRIES = 3;

export const AlephaLoreDeploy = $module({
  name: "alepha.lore.deploy",
  imports: [AlephaServerLinksClient],
  // A read that got no answer is sent again (#Q3910). A CI runner's
  // connection to Lore's edge is reset now and then, seen as `read
  // ECONNRESET` on the first read after an artifact push, on a request that
  // never reached Lore. Writes are not covered: `LoreDeployer.start` and the
  // artifact push each handle their own.
  register: (alepha) => {
    alepha.store.mut(httpClientOptions, (options) => ({
      ...options,
      networkRetries: LORE_NETWORK_RETRIES,
    }));
  },
  services: [
    LoreClientService,
    LoreTokenStore,
    // `.alepha/lore.json`, read at start (#Q2698).
    LoreProjectLink,
    LoreProjectResolver,
    GitContextService,
    // The quests a pushed commit's history references (#E154).
    GitQuestHistory,
    ArtifactUploader,
    LoreArtifactPusher,
    LoreDeployer,
    LoreSecretsService,
    LoreDeviceLogin,
    // The infra adapter itself: `infra()` registers it by class, which
    // registers this module, and so none of the `lore` commands.
    LoreAdapter,
  ],
});
