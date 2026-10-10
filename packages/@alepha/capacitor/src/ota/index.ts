import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./protocol/index.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Live updates of a native shell's web layer, from the app's own server.
 *
 * @module alepha.capacitor.ota
 */
export const AlephaCapacitorOta = $module({
  name: "alepha.capacitor.ota",
  services: [],
});
