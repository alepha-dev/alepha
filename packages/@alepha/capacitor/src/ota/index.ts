import { Capacitor } from "@capacitor/core";
import { $module } from "alepha";

import { AlephaCapacitor } from "../core/index.ts";
import { ContentInspector } from "../core/providers/ContentInspector.ts";
import { CapgoUpdaterAdapter } from "./providers/CapgoUpdaterAdapter.ts";
import { OtaContentInspector } from "./providers/OtaContentInspector.ts";
import { OtaProvider } from "./providers/OtaProvider.ts";
import { UpdaterAdapter } from "./providers/UpdaterAdapter.ts";
import { OtaLocalState } from "./services/OtaLocalState.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./interfaces/OtaBundle.ts";
export * from "./protocol/index.ts";
export * from "./providers/CapgoUpdaterAdapter.ts";
export * from "./providers/MemoryUpdaterAdapter.ts";
export * from "./providers/OtaContentInspector.ts";
export * from "./providers/OtaProvider.ts";
export * from "./providers/UpdaterAdapter.ts";
export * from "./services/OtaLocalState.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Live updates of a native shell's web layer, from the app's own server
 * (`@alepha/capacitor/ota-api`), through the pinned
 * `@capgo/capacitor-updater` 8.52.1 in manual mode.
 *
 * Import it in the browser entry, after `AlephaCapacitor`:
 *
 * ```ts
 * alepha.with(AlephaCapacitor);
 * alepha.with(AlephaCapacitorOta);
 * ```
 *
 * {@link OtaProvider} acknowledges every healthy boot (the offline screen
 * included, without waiting for the API), checks on boot and on resume,
 * downloads full encrypted bundles in the background and applies them on
 * the next background or restart, follows rollbacks to older versions and
 * the kill switch at the next contact, and never fetches again a bundle this
 * device rolled back from. Inert in a browser, in `dev` mode, and in a shell
 * built without the updater, with the reason in the log.
 *
 * The native config is written by `alepha capacitor init --ota`:
 * `autoUpdate: false`, the `/ota` URLs, the publisher's `publicKey`, and
 * `allowManualBundleError: true` (cancelling a pending bundle needs it).
 *
 * The wire schemas the server shares (`ota/protocol`) are exported here
 * too.
 *
 * @module alepha.capacitor.ota
 */
export const AlephaCapacitorOta = $module({
  name: "alepha.capacitor.ota",
  imports: [AlephaCapacitor],
  register: (alepha) => {
    // A substitution a spec made earlier wins: the first one recorded is the
    // one kept.
    if (Capacitor.isNativePlatform()) {
      alepha.with({ provide: UpdaterAdapter, use: CapgoUpdaterAdapter });
    }
    alepha.with({ provide: ContentInspector, use: OtaContentInspector });
  },
  services: [UpdaterAdapter, OtaLocalState, OtaProvider],
});
