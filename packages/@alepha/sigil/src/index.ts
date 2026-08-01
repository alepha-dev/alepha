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
export * from "./shared/sigilPaths.ts";
export * from "./sigilEnv.ts";

/**
 * The sigil an Alepha app reports under: page views, web vitals, and client
 * and server errors — pushed to a sink that the app names.
 *
 * Import this module in your WebModule and set `SIGIL_SINK` +
 * `SIGIL_KEY`. Without them the module still captures, but nothing leaves
 * the machine: errors go to the logger instead, aggregated. Active in
 * production only.
 *
 * **Nothing is mounted for you.** The petition button used to be injected into
 * every host app's React tree as a root component. It still ships — as
 * `<SigilRoot />` from `@alepha/sigil/react` — but the app decides where it
 * goes, or skips it entirely and renders its own link from `usePetitionUrl()`.
 * A reporting package that injects DOM on its own is one you then have to
 * style, translate and keep out of your layout, for one button.
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
