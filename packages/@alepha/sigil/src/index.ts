import { $module } from "alepha";
import { SigilBrowserProvider } from "./browser/SigilBrowserProvider.ts";
import { SigilProxyController } from "./server/SigilProxyController.ts";
import { SigilServerErrors } from "./server/SigilServerErrors.ts";
import { SigilSinkProvider } from "./server/SigilSinkProvider.ts";
import { sigilClientAtom } from "./shared/sigilClientAtom.ts";
import { sigilOptions } from "./shared/sigilOptionsAtom.ts";

export * from "./server/SigilSinkProvider.ts";
export * from "./shared/sigilClientAtom.ts";
export * from "./shared/sigilFeatures.ts";
export * from "./shared/sigilOptionsAtom.ts";
export * from "./sigilEnv.ts";

/**
 * Telemetry for Alepha apps: page views, web vitals, and client and server
 * errors — pushed to a sink (Sigil) that the app names.
 *
 * Import this module in your WebModule and set `SIGIL_SINK` +
 * `SIGIL_KEY`. Without them the module still captures, but nothing leaves
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
export const AlephaSigil = $module({
  name: "alepha.sigil",
  atoms: [sigilOptions, sigilClientAtom],
  services: [
    SigilSinkProvider,
    SigilProxyController,
    SigilServerErrors,
    SigilBrowserProvider,
  ],
});
