import { type Infer, z } from "alepha";

/**
 * How the owner answers a review item (#E121): exactly one of their own
 * text, a suggestion by its index, or a waive.
 */
export const epicReviewAnswerSchema = z.object({
  answer: z
    .string()
    .meta({ size: "rich" })
    .describe(
      "The owner's answer in their own words. On a decision, the decision that replaces it.",
    )
    .optional(),
  suggestion: z
    .integer()
    .min(0)
    .describe("Pick one of the item's suggestions, by index from 0.")
    .optional(),
  waive: z
    .boolean()
    .describe(
      "Set a question aside unanswered. A decision cannot be waived, only overturned.",
    )
    .optional(),
});

export type EpicReviewAnswer = Infer<typeof epicReviewAnswerSchema>;
