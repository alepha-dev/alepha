import { type Infer, z } from "alepha";

import { epicReviewResourceSchema } from "./epicReviewResourceSchema.ts";

/**
 * Every review of an epic, newest first, each with its items, and the counts
 * of questions and blockers still open: what the Review tab, `epic_get` and
 * `lore epic get` read (#E121, #Q3634).
 */
export const epicReviewsResultSchema = z.object({
  reviews: z.array(epicReviewResourceSchema),
  openQuestions: z.integer(),
  openBlockers: z.integer(),
  /**
   * The epic's last Review with Claude job (#Q4214), for the tab's link.
   */
  agentJobId: z.uuid().optional(),
});

export type EpicReviewsResult = Infer<typeof epicReviewsResultSchema>;
