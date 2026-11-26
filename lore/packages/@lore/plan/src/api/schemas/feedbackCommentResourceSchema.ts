import { comments } from "@lore/core/schemas";
import { type Infer, z } from "alepha";

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
export const feedbackCommentResourceSchema = comments.schema
  // What core's row says in general terms, the feedback thread says as
  // `feedbackId` (#E185), the shape it has always answered.
  .omit({ projectId: true, subjectType: true, subjectId: true })
  .extend({
    feedbackId: z.integer(),
    /**
     * Always an array on the wire, as it was while the column defaulted to
     * `[]`: core's column is optional, and absent reads as no file.
     */
    attachments: z.array(z.uuid()),
    authorName: z
      .string()
      .describe(
        "Display name of the author. Absent once they delete their account.",
      )
      .optional(),
    /**
     * The comment's attachments, resolved like `FeedbackResource.attachmentUrls`
     * so the thread renders them without a request per file.
     */
    attachmentUrls: z
      .array(
        z.object({
          id: z.uuid(),
          name: z.string(),
          url: z.string(),
          mimeType: z.string(),
          size: z.number(),
        }),
      )
      .optional(),
  });

export type FeedbackCommentResource = Infer<
  typeof feedbackCommentResourceSchema
>;
