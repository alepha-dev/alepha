import { $module } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./schemas/capacitorPublicConfigSchema.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Native capabilities for an Alepha app running in a Capacitor shell.
 *
 * Import this module in the app's browser entry. Inside the native shell it
 * binds the native implementations; in a plain browser it binds web
 * fallbacks, so the same app code runs on both. App code never imports
 * `@capacitor/*` itself.
 *
 * The shell and its native projects are made by `@alepha/capacitor/cli`.
 *
 * @module alepha.capacitor
 */
export const AlephaCapacitor = $module({
  name: "alepha.capacitor",
  services: [],
});
