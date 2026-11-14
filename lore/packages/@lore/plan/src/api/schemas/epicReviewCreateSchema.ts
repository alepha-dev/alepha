import { type Infer, z } from "alepha";

import { epicReviewItemInputSchema } from "./epicReviewItemInputSchema.ts";

/**
 * The body that files a review with every item at once (#E121).
 */
export const epicReviewCreateSchema = z.object({
  summary: z
    .string()
    .max(2000)
    .describe("What the review concluded, in a line or two.")
    .optional(),
  items: z.array(epicReviewItemInputSchema).max(100),
});

export type EpicReviewCreate = Infer<typeof epicReviewCreateSchema>;
