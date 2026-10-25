import { type Infer, z } from "alepha";

/**
 * Change the share of a cohort that gets its active bundle.
 */
export const otaRolloutSchema = z.object({
  cohort: z.text(),
  rollout: z.integer().min(0).max(100),
});

export type OtaRollout = Infer<typeof otaRolloutSchema>;
