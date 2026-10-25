import { type Infer, z } from "alepha";

/**
 * What a channel serves to one compatibility cohort, the devices of one
 * platform running binaries of one native fingerprint.
 *
 * - `active`: the bundle the channel serves, to `rollout` percent of its
 *   devices (a stable hash of app, channel and device decides who);
 * - `fallback`: what everyone else gets, and what a killed `active` gives
 *   way to. Set to the previous `active` on each promotion, or by an
 *   operator; never "the previous upload", which nobody vouched for.
 */
export const otaChannelCohortSchema = z.object({
  active: z.uuid().optional(),
  fallback: z.uuid().optional(),
  rollout: z.integer().min(0).max(100),
});

export type OtaChannelCohort = Infer<typeof otaChannelCohortSchema>;
