import { type Infer, z } from "alepha";

/**
 * Serve a bundle from a channel, to `rollout` percent of its cohort.
 */
export const otaPromoteSchema = z.object({
  bundleId: z.uuid(),
  rollout: z.integer().min(0).max(100),
});

export type OtaPromote = Infer<typeof otaPromoteSchema>;
