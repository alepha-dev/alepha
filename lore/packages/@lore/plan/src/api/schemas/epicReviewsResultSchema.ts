import { type Infer, z } from "alepha";

import { epicReviewResourceSchema } from "./epicReviewResourceSchema.ts";

/**
 * Every review of an epic, newest first, each with its items, and the count
 * of questions still open: what the Review tab, `epic_get` and
 * `lore epic get` read (#E121).
 */
export const epicReviewsResultSchema = z.object({
  reviews: z.array(epicReviewResourceSchema),
  openQuestions: z.integer(),
});

export type EpicReviewsResult = Infer<typeof epicReviewsResultSchema>;
