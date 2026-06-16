import { $module } from "alepha";
import { RootComponentsProvider } from "alepha/react/router";
import { createElement } from "react";
import { SigilRoot } from "./browser/components/SigilRoot.tsx";
import { SigilBrowserProvider } from "./browser/SigilBrowserProvider.ts";
import { SigilForwardProvider } from "./server/SigilForwardProvider.ts";
import { SigilProxyController } from "./server/SigilProxyController.ts";
import { SigilServerErrors } from "./server/SigilServerErrors.ts";
import { sigilClientAtom } from "./shared/sigilClientAtom.ts";
import { sigilOptions } from "./shared/sigilOptionsAtom.ts";

export * from "./browser/components/SigilRoot.tsx";
export * from "./server/SigilForwardProvider.ts";
export * from "./shared/sigilClientAtom.ts";
export * from "./shared/sigilFeatures.ts";
export * from "./shared/sigilOptionsAtom.ts";
export * from "./sigilEnv.ts";

/**
 * Lore Sigil for Alepha apps: beacon + web-vitals + client/server blights +
 * an in-app annotated-screenshot petition. Enable by importing this module in
 * your WebModule and setting SIGIL_ID (server env). Active in production only.
 *
 * Server services self-guard to the server; the browser bootstrap guards the
 * browser; `register` mounts the UI slot in both (SSR + hydration), prod only.
 */
export const AlephaSigil = $module({
  name: "alepha.sigil",
  atoms: [sigilOptions, sigilClientAtom],
  services: [
    RootComponentsProvider,
    SigilForwardProvider,
    SigilProxyController,
    SigilServerErrors,
    SigilBrowserProvider,
  ],
  register: (alepha) => {
    if (!alepha.isProduction()) return;
    alepha
      .inject(RootComponentsProvider)
      .rootComponents.push(createElement(SigilRoot, { key: "alepha-sigil" }));
  },
});
