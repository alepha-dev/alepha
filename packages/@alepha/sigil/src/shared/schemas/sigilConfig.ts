import { type Infer, z } from "alepha";
import { SIGIL_TRACKERS } from "../sigilFeatures.ts";

/**
 * What the sink tells an app about how much it wants.
 *
 * Fetched at runtime rather than read from env, because the two things it
 * carries — a kill-switch and an appetite — are useless if reaching for them
 * requires a redeploy. A sink drowning in one app's vitals must be able to turn
 * them down from its own side, immediately.
 *
 * Every field is optional so an older sink, or one that grows a field later,
 * never breaks a running app: unknown keys are ignored, missing keys keep their
 * default.
 */
export const sigilConfig = z.object({
  /** Per-tracker kill-switch. Missing tracker = left as it was. */
  enabled: z
    .object(
      Object.fromEntries(
        SIGIL_TRACKERS.map((t) => [t, z.boolean().optional()]),
      ) as Record<
        (typeof SIGIL_TRACKERS)[number],
        ReturnType<ReturnType<typeof z.boolean>["optional"]>
      >,
    )
    .optional(),
  /**
   * Fraction of samples to keep, per tracker, between 0 and 1.
   *
   * Applied at the source: an app that samples at 0.1 sends a tenth, rather
   * than sending everything for the sink to throw away. The bandwidth and the
   * battery are the app's, not the sink's.
   */
  sampling: z
    .object({
      views: z.number().min(0).max(1).optional(),
      errors: z.number().min(0).max(1).optional(),
      vitals: z.number().min(0).max(1).optional(),
    })
    .optional(),
  /**
   * Where a user goes to file a petition, or absent when the sink offers none.
   *
   * A URL rather than a feature flag: the app renders a link, and nothing in
   * this package needs to know what is behind it.
   */
  petitionUrl: z.string().max(2000).optional(),
});

export type SigilConfig = Infer<typeof sigilConfig>;

/**
 * What an app assumes before the sink has answered — and keeps assuming if it
 * never does.
 *
 * Every tracker stays on and nothing is sampled out. The failure this guards
 * against is an app that cannot reach its sink and *over-emits* into the
 * void; collecting a little less than the sink could take is recoverable,
 * hammering it on reconnect is not.
 */
export const SIGIL_CONFIG_DEFAULTS = {
  sampling: { views: 1, errors: 1, vitals: 1 },
} as const;
