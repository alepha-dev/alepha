import { $atom, type Infer, z } from "alepha";
import { SIGIL_TRACKERS } from "./sigilFeatures.ts";

/**
 * The public sigil config handed to the browser through SSR hydration: which
 * trackers are on, how much to sample, which paths to skip, and where
 * feedback goes.
 *
 * **It never contains the key.** The browser talks only to its own origin; the
 * credential stays on the app's server, where the sink is called from.
 *
 * Set per request on the server (in a `react:server:render:begin` hook) so that
 * `exportAtoms("current")` serializes it into the page, and read on the client
 * by `SigilBrowserProvider`.
 *
 * Default = every tracker on, nothing sampled out. Same reasoning as the server
 * side: before the sink has spoken, collect.
 */
export const sigilClientAtom = $atom({
  name: "alepha.sigil.client",
  description:
    "Public sigil config sent to the browser: enabled trackers, sampling, excluded paths, feedback URL. Never contains the key.",
  schema: z.object({
    enabled: z.record(z.string(), z.boolean()),
    sampling: z.record(z.string(), z.number()),
    excludedPaths: z.array(z.string()),
    feedbackUrl: z.string().optional(),
  }),
  default: {
    enabled: Object.fromEntries(SIGIL_TRACKERS.map((t) => [t, true])),
    sampling: { views: 1, errors: 1, vitals: 1 },
    excludedPaths: [],
  },
});

export type SigilClientConfig = Infer<typeof sigilClientAtom.schema>;
