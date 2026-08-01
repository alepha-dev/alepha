import { $module } from "alepha";
import { SigilBrowserProvider } from "./browser/SigilBrowserProvider.ts";
import { sigilClientAtom } from "./shared/sigilClientAtom.ts";

export { SigilFeedbackButton } from "./browser/components/SigilFeedbackButton.tsx";
export { SigilRoot } from "./browser/components/SigilRoot.tsx";
export * from "./browser/usePetitionUrl.ts";
export * from "./shared/sigilClientAtom.ts";
export * from "./shared/sigilFeatures.ts";
export * from "./sigilEnv.ts";

/**
 * Browser-safe build of the telemetry module.
 *
 * Server-only services (`SigilProxyController`, `SigilSinkProvider`,
 * `SigilServerErrors`) import `$action` from `alepha/server`, which is not
 * available in the browser bundle. This entry excludes them — the browser only
 * needs `SigilBrowserProvider`, which captures views, vitals and errors and
 * posts them to this app's own loopback endpoint.
 *
 * Both ways to render the petition link ship: `usePetitionUrl()` for a host
 * app that wants to render its own link, and `<SigilRoot />` — mounting the
 * batteries-included floating feedback button — for one that does not.
 * Neither is mounted automatically; the host app chooses.
 *
 * The `browser` export condition in `package.json` routes Vite's client build
 * here instead of `index.ts`.
 */
export const AlephaSigil = $module({
  name: "alepha.sigil",
  atoms: [sigilClientAtom],
  services: [SigilBrowserProvider],
});
