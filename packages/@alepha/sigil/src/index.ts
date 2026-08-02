import { $module } from "alepha";
import { RootComponentsProvider } from "alepha/react/router";
import { createElement } from "react";
import { SigilRoot } from "./browser/components/SigilRoot.tsx";
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
 * **The feedback button mounts itself.** `<SigilRoot />` is pushed into
 * {@link RootComponentsProvider}, so importing this module is the whole
 * integration — there is no second module and no JSX to place. The component
 * renders `null` unless the sink hands out a `petitionUrl` and the current path
 * is not excluded, so an app with no sink configured sees nothing.
 *
 * This entry therefore pulls React. That was once avoided so a headless API app
 * could import the module without it, but `react` and `react-dom` are already
 * peer dependencies of this package, so such an app had to install them anyway
 * — the split bought one unused import at the cost of a second module every
 * host had to know about. If a genuinely React-free consumer ever appears, move
 * the `register` below into its own module behind `@alepha/sigil/react`.
 *
 * An app that wants the link somewhere else in its own layout can still render
 * it from `usePetitionUrl()`; `<SigilRoot />` hides itself when there is no URL,
 * so the two do not fight.
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
  register(alepha) {
    alepha
      .inject(RootComponentsProvider)
      .rootComponents.push(createElement(SigilRoot));
  },
});
