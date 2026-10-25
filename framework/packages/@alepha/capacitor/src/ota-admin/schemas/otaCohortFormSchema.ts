import { z } from "alepha";

/**
 * What one cohort serves: a bundle, and the share that gets it.
 */
export const otaCohortFormSchema = z.object({
  bundleId: z.text().optional(),
  rollout: z.integer().min(0).max(100),
});
