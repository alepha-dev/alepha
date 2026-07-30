import { $module } from "alepha";
import { TelemetryBrowserProvider } from "./browser/TelemetryBrowserProvider.ts";
import { TelemetryProxyController } from "./server/TelemetryProxyController.ts";
import { TelemetryServerErrors } from "./server/TelemetryServerErrors.ts";
import { TelemetrySinkProvider } from "./server/TelemetrySinkProvider.ts";
import { telemetryClientAtom } from "./shared/telemetryClientAtom.ts";
import { telemetryOptions } from "./shared/telemetryOptionsAtom.ts";

export * from "./server/TelemetrySinkProvider.ts";
export * from "./shared/telemetryClientAtom.ts";
export * from "./shared/telemetryFeatures.ts";
export * from "./shared/telemetryOptionsAtom.ts";
export * from "./telemetryEnv.ts";

/**
 * Telemetry for Alepha apps: page views, web vitals, client and server errors,
 * and periodic server metrics — pushed to a sink (Pulse) that the app names.
 *
 * Import this module in your WebModule and set `TELEMETRY_SINK` +
 * `TELEMETRY_KEY`. Without them the module still captures, but nothing leaves
 * the machine: errors go to the logger instead, aggregated. Active in
 * production only.
 *
 * **No UI.** The petition button used to be mounted here as a root component;
 * it is now a plain link the app renders wherever it wants, from
 * `usePetitionUrl()`. A telemetry package that injects DOM is a telemetry
 * package that has to be styled, translated and tested as a UI — for one
 * button.
 *
 * Server services self-guard to the server; the browser bootstrap guards the
 * browser.
 */
export const AlephaTelemetry = $module({
  name: "alepha.telemetry",
  atoms: [telemetryOptions, telemetryClientAtom],
  services: [
    TelemetrySinkProvider,
    TelemetryProxyController,
    TelemetryServerErrors,
    TelemetryBrowserProvider,
  ],
});
