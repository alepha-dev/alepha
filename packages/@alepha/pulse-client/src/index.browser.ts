import { $module } from "alepha";
import { PulseBrowserProvider } from "./browser/PulseBrowserProvider.ts";
import { pulseClientAtom } from "./shared/pulseClientAtom.ts";

export * from "./browser/usePetitionUrl.ts";
export * from "./pulseEnv.ts";
export * from "./shared/pulseClientAtom.ts";
export * from "./shared/pulseFeatures.ts";

/**
 * Browser-safe build of the telemetry module.
 *
 * Server-only services (`PulseProxyController`, `PulseSinkProvider`,
 * `PulseServerErrors`) import `$action` from `alepha/server`, which is not
 * available in the browser bundle. This entry excludes them — the browser only
 * needs `PulseBrowserProvider`, which captures views, vitals and errors and
 * posts them to this app's own loopback endpoint.
 *
 * Nothing is mounted into the React tree any more: the petition button is a
 * link the app renders itself, from `usePetitionUrl()`.
 *
 * The `browser` export condition in `package.json` routes Vite's client build
 * here instead of `index.ts`.
 */
export const AlephaPulse = $module({
  name: "alepha.pulse",
  atoms: [pulseClientAtom],
  services: [PulseBrowserProvider],
});
