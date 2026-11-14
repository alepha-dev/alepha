import { type Infer, z } from "alepha";

/**
 * One way forward a reviewer offers on a question or a decision (#E121):
 * what to do, and what it costs. The owner answers a question by picking
 * one, by its index, or by writing their own.
 */
export const epicReviewSuggestionSchema = z.object({
  label: z.string().min(1).max(1000),
  /**
   * What taking it costs, in the reviewer's words ("one more table",
   * "a day of work", "breaks the CLI's flag names").
   */
  cost: z.string().max(1000).optional(),
});

export type EpicReviewSuggestion = Infer<typeof epicReviewSuggestionSchema>;
