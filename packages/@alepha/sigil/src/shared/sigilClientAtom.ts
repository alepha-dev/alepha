import { $atom, type Static, z } from "alepha";
import { SIGIL_FEATURES } from "./sigilFeatures.ts";

/**
 * The public sigil config delivered to the browser via SSR hydration: the
 * enabled features + path exclusions. It NEVER contains the secret id.
 *
 * Set per request on the server (in a `react:server:render:begin` hook) so that
 * `exportAtoms("current")` serializes it into the page; read on the client by
 * `SigilBrowserProvider` (telemetry gating) and `SigilRoot` (petition button).
 *
 * Default = all features on, no exclusions — preserving the legacy "collect
 * everything" behavior when `SIGIL_FEATURES` is unset.
 */
export const sigilClientAtom = $atom({
  name: "alepha.sigil.client",
  description:
    "Public sigil config sent to the browser: enabled features + excluded paths. Never contains the id.",
  schema: z.object({
    features: z.array(z.string()),
    excludedPaths: z.array(z.string()),
  }),
  default: { features: [...SIGIL_FEATURES], excludedPaths: [] },
});

export type SigilClientConfig = Static<typeof sigilClientAtom.schema>;
