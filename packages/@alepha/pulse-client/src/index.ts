import { $module } from "alepha";
import { PulseBrowserProvider } from "./browser/PulseBrowserProvider.ts";
import { PulseMetricsProvider } from "./server/PulseMetricsProvider.ts";
import { PulseProxyController } from "./server/PulseProxyController.ts";
import { PulseServerErrors } from "./server/PulseServerErrors.ts";
import { PulseSinkProvider } from "./server/PulseSinkProvider.ts";
import { pulseClientAtom } from "./shared/pulseClientAtom.ts";
import { pulseOptions } from "./shared/pulseOptionsAtom.ts";

export * from "./pulseEnv.ts";
export * from "./server/PulseSinkProvider.ts";
export * from "./shared/pulseClientAtom.ts";
export * from "./shared/pulseFeatures.ts";
export * from "./shared/pulseOptionsAtom.ts";

/**
 * Telemetry for Alepha apps: page views, web vitals, client and server errors,
 * and periodic server metrics — pushed to a sink (Pulse) that the app names.
 *
 * Import this module in your WebModule and set `PULSE_SINK` +
 * `PULSE_KEY`. Without them the module still captures, but nothing leaves
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
export const AlephaPulse = $module({
  name: "alepha.pulse",
  atoms: [pulseOptions, pulseClientAtom],
  services: [
    PulseSinkProvider,
    PulseMetricsProvider,
    PulseProxyController,
    PulseServerErrors,
    PulseBrowserProvider,
  ],
});
