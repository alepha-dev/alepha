import { $module } from "alepha";
import { TelemetryBrowserProvider } from "./browser/TelemetryBrowserProvider.ts";
import { telemetryClientAtom } from "./shared/telemetryClientAtom.ts";

export * from "./browser/usePetitionUrl.ts";
export * from "./shared/telemetryClientAtom.ts";
export * from "./shared/telemetryFeatures.ts";
export * from "./telemetryEnv.ts";

/**
 * Browser-safe build of the telemetry module.
 *
 * Server-only services (`TelemetryProxyController`, `TelemetrySinkProvider`,
 * `TelemetryServerErrors`) import `$action` from `alepha/server`, which is not
 * available in the browser bundle. This entry excludes them — the browser only
 * needs `TelemetryBrowserProvider`, which captures views, vitals and errors and
 * posts them to this app's own loopback endpoint.
 *
 * Nothing is mounted into the React tree any more: the petition button is a
 * link the app renders itself, from `usePetitionUrl()`.
 *
 * The `browser` export condition in `package.json` routes Vite's client build
 * here instead of `index.ts`.
 */
export const AlephaTelemetry = $module({
  name: "alepha.telemetry",
  atoms: [telemetryClientAtom],
  services: [TelemetryBrowserProvider],
});
