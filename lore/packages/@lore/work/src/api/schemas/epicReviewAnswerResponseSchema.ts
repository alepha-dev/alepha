import { type Infer, z } from "alepha";

import { epicReviewItemResourceSchema } from "./epicReviewItemResourceSchema.ts";

/**
 * What an answer did (#E121): the item, its outcome, and on an overturn the
 * decision filed in place of the old one.
 */
export const epicReviewAnswerResponseSchema = z.object({
  outcome: z.enum(["answered", "waived", "overturned"]),
  item: epicReviewItemResourceSchema,
  replacement: epicReviewItemResourceSchema.optional(),
});

export type EpicReviewAnswerResponse = Infer<
  typeof epicReviewAnswerResponseSchema
>;
