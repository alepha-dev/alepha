import { $atom, type Static, z } from "alepha";
import { TELEMETRY_TRACKERS } from "./pulseFeatures.ts";

/**
 * The public telemetry config handed to the browser through SSR hydration:
 * which trackers are on, how much to sample, which paths to skip, and where a
 * petition goes.
 *
 * **It never contains the key.** The browser talks only to its own origin; the
 * credential stays on the app's server, where the sink is called from.
 *
 * Set per request on the server (in a `react:server:render:begin` hook) so that
 * `exportAtoms("current")` serializes it into the page, and read on the client
 * by `PulseBrowserProvider`.
 *
 * Default = every tracker on, nothing sampled out. Same reasoning as the server
 * side: before the sink has spoken, collect.
 */
export const pulseClientAtom = $atom({
  name: "alepha.pulse.client",
  description:
    "Public telemetry config sent to the browser: enabled trackers, sampling, excluded paths, petition URL. Never contains the key.",
  schema: z.object({
    enabled: z.record(z.string(), z.boolean()),
    sampling: z.record(z.string(), z.number()),
    excludedPaths: z.array(z.string()),
    petitionUrl: z.string().optional(),
  }),
  default: {
    enabled: Object.fromEntries(TELEMETRY_TRACKERS.map((t) => [t, true])),
    sampling: { views: 1, errors: 1, vitals: 1 },
    excludedPaths: [],
  },
});

export type TelemetryClientConfig = Static<typeof pulseClientAtom.schema>;
