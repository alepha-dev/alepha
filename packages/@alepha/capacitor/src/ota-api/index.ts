import { $module } from "alepha";

import { OtaBundleInspector } from "./services/OtaBundleInspector.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./services/OtaBundleInspector.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The server side of live updates: bundles, channels and the update protocol
 * the pinned updater speaks.
 *
 * @module alepha.capacitor.ota.api
 */
export const AlephaCapacitorOtaApi = $module({
  name: "alepha.capacitor.ota.api",
  services: [OtaBundleInspector],
});
