import { comments } from "@lore/core/schemas";
import { type Infer, z } from "alepha";

/**
 * A quest comment as the API hands it out.
 *
 * The entity shape plus its resolved attachments. The author is
 * deliberately left as a bare id. The feed resolves ids to names
 * and avatars through `getProjectUsers` — one fetch per page rather than a
 * joined user object per comment, which is the same call it already makes to
 * resolve the actors of the history events it interleaves these with.
 */
export const questCommentResourceSchema = comments.schema
  // What core's row says in general terms, the quest thread says as
  // `questId` (#E185): the shape the web and `quest_comment_add` have read
  // since the comments were a table of Plan's own.
  .omit({ projectId: true, subjectType: true, subjectId: true })
  .extend({
    questId: z.integer(),
    /**
     * The comment's attachments, resolved so the thread renders them without
     * a request per file. Same shape as a feedback comment's.
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

export type QuestCommentResource = Infer<typeof questCommentResourceSchema>;
