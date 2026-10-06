import { type Infer, z } from "alepha";

import { feedbackComments } from "../entities/feedbackComments.ts";

/**
 * A feedback comment as the API hands it out.
 *
 * Unlike `questCommentResourceSchema`, this is NOT the entity verbatim: it
 * carries the author's display name. A quest thread is read only by project
 * members, who can fetch the member list and resolve ids themselves; a
 * feedback thread is also read by the reporter, who is usually not a member
 * and cannot call `getProjectUsers` at all. Resolving server-side is what
 * lets both audiences see who is talking, and it discloses only the names of
 * people who actually spoke on that reporter's own item.
 */
export const feedbackCommentResourceSchema = feedbackComments.schema.extend({
  authorName: z
    .string()
    .describe(
      "Display name of the author. Absent once they delete their account.",
    )
    .optional(),
});

export type FeedbackCommentResource = Infer<
  typeof feedbackCommentResourceSchema
>;
