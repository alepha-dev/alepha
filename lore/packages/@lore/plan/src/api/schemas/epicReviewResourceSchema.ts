import { type Infer, z } from "alepha";

import { epicReviews } from "../entities/epicReviews.ts";
import { epicReviewItemResourceSchema } from "./epicReviewItemResourceSchema.ts";

/**
 * One review with its items, by number (#E121).
 */
export const epicReviewResourceSchema = epicReviews.schema.extend({
  items: z.array(epicReviewItemResourceSchema),
});

export type EpicReviewResource = Infer<typeof epicReviewResourceSchema>;
