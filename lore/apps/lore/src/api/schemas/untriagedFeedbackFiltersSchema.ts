import { type Infer, z } from "alepha";

/**
 * Filter vocabulary of the `untriagedFeedback` metric.
 *
 * ⚠️ These are feedback lifecycle values (`pending` / `accepted` /
 * `rejected`), not the quest ones. "Untriaged" in the mockup's chip is
 * `pending`.
 */
export const untriagedFeedbackFiltersSchema = z.object({
  status: z.enum(["pending", "all"]).meta({ mode: "text" }).default("pending"),
});

export type UntriagedFeedbackFilters = Infer<
  typeof untriagedFeedbackFiltersSchema
>;
