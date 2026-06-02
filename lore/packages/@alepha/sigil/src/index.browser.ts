import { $module } from "alepha";
import { RootComponentsProvider } from "alepha/react/router";
import { createElement } from "react";
import { SigilRoot } from "./browser/components/SigilRoot.tsx";
import { SigilBrowserProvider } from "./browser/SigilBrowserProvider.ts";

export * from "./browser/components/SigilRoot.tsx";
export * from "./sigilEnv.ts";

/**
 * Browser-safe build of the Lore Sigil module.
 *
 * Server-only services (`SigilProxyController`, `SigilForwardProvider`,
 * `SigilServerErrors`) import `$action` from `alepha/server`, which is not
 * available in the browser bundle. This entry excludes them — the browser
 * only needs `SigilBrowserProvider` (telemetry batching) and `SigilRoot`
 * (feedback dialog mounted into the React tree via `RootComponentsProvider`).
 *
 * The `browser` export condition in `package.json` routes Vite's client
 * build here instead of `index.ts`.
 */
export const AlephaSigil = $module({
  name: "alepha.sigil",
  services: [RootComponentsProvider, SigilBrowserProvider],
  register: (alepha) => {
    if (!alepha.isProduction()) return;
    alepha
      .inject(RootComponentsProvider)
      .rootComponents.push(createElement(SigilRoot, { key: "alepha-sigil" }));
  },
});
