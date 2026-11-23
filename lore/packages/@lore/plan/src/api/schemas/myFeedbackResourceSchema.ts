import { type Infer, z } from "alepha";

import { feedbackResourceSchema } from "./feedbackResourceSchema.ts";

/**
 * A feedback item as seen by its reporter on the `/me` profile page.
 *
 * Extends {@link feedbackResourceSchema} with the owning `project` (title +
 * icon) so the cross-project list can show which project each feedback
 * item belongs to without a per-row lookup.
 */
export const myFeedbackResourceSchema = feedbackResourceSchema
  // A reporter need not be a member: who triaged, and who trusted the item
  // (#Q4216), is the project's business.
  .omit({ triagedBy: true, trustedBy: true, truster: true })
  .extend({
    project: z.object({
      id: z.integer(),
      title: z.string(),
      icon: z.union([z.uuid(), z.null()]).optional(),
    }),
  });

export type MyFeedbackResource = Infer<typeof myFeedbackResourceSchema>;
