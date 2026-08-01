import { $module } from "alepha";
import { SigilBrowserProvider } from "./browser/SigilBrowserProvider.ts";
import { sigilClientAtom } from "./shared/sigilClientAtom.ts";

export * from "./shared/sigilClientAtom.ts";
export * from "./shared/sigilFeatures.ts";
export * from "./sigilEnv.ts";

/**
 * Browser-safe build of the sigil module.
 *
 * Server-only services (`SigilProxyController`, `SigilSinkProvider`,
 * `SigilServerErrors`) import `$action` from `alepha/server`, which is not
 * available in the browser bundle. This entry excludes them — the browser only
 * needs `SigilBrowserProvider`, which captures views, vitals and errors and
 * posts them to this app's own loopback endpoint.
 *
 * The `browser` export condition in `package.json` routes Vite's client build
 * here instead of `index.ts`.
 *
 * The React surface — `<SigilRoot />`, `<SigilFeedbackButton />` and
 * `usePetitionUrl()` — is deliberately **not** re-exported here. It lives at
 * `@alepha/sigil/react`, a condition-free subpath, so that it resolves the same
 * way on an SSR server pass as in a client bundle. Exporting it from a
 * `browser`-only entry made it unimportable under `types` / `import` /
 * `default`, which is a compile error in every host that is not a browser
 * bundle.
 */
export const AlephaSigil = $module({
  name: "alepha.sigil",
  atoms: [sigilClientAtom],
  services: [SigilBrowserProvider],
});
