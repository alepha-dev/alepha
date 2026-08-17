import { $module } from "alepha";
import { AlephaBackground } from "alepha/background";
import { RootComponentsProvider } from "alepha/react/router";
import { createElement } from "react";
import { SigilRoot } from "./browser/components/SigilRoot.tsx";
import { SigilBrowserProvider } from "./browser/SigilBrowserProvider.ts";
import { SigilProxyController } from "./server/SigilProxyController.ts";
import { SigilServerErrors } from "./server/SigilServerErrors.ts";
import { SigilSinkProvider } from "./server/SigilSinkProvider.ts";
import { sigilClientAtom } from "./shared/sigilClientAtom.ts";

export * from "./server/SigilSinkProvider.ts";
export * from "./shared/sigilClientAtom.ts";
export * from "./shared/sigilFeatures.ts";
export * from "./shared/sigilPaths.ts";
export * from "./sigilEnv.ts";

/**
 * The sigil an Alepha app reports under: page views, web vitals, and client
 * and server errors — pushed to a sink that the app names.
 *
 * Import this module in your WebModule and set `SIGIL_KEY` — the one variable
 * that matters, alongside `SIGIL_CONFIG` which names the project and what to
 * collect. Its `sink` field defaults to the public Lore instance and is only
 * needed to self-host; `SIGIL_SALT` falls back to `APP_SECRET`. Without a key
 * the module still captures, but nothing leaves the machine: errors go to the
 * logger instead, aggregated. Active in production only.
 *
 * **The feedback button mounts itself.** `<SigilRoot />` is pushed into
 * {@link RootComponentsProvider}, so importing this module is the whole
 * integration — there is no second module and no JSX to place. The component
 * renders `null` unless the sink hands out a `feedbackUrl` and the current path
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
 * it from `useFeedbackUrl()`; `<SigilRoot />` hides itself when there is no URL,
 * so the two do not fight.
 *
 * Server services self-guard to the server; the browser bootstrap guards the
 * browser.
 */
export const AlephaSigil = $module({
  name: "alepha.sigil",
  // `AlephaBackground` is not optional here, and the failure without it is
  // silent. `SigilSinkProvider` defers its end-of-request flush so the sink
  // round trip is not inside the browser's own call; on workerd only the
  // variant this module registers wraps that in `executionCtx.waitUntil`.
  // Without it the base provider's `keepAlive` is a no-op, the isolate is
  // frozen the moment the response is returned, and the flush never completes
  // — an app that answers every beacon `{"ok":true}` and delivers nothing.
  imports: [AlephaBackground],
  atoms: [sigilClientAtom],
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
