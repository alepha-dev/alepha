import { type Infer, z } from "alepha";

import { questComments } from "../entities/questComments.ts";

/**
 * A quest comment as the API hands it out.
 *
 * The entity shape plus its resolved attachments. The author is
 * deliberately left as a bare id. The feed resolves ids to names
 * and avatars through `getProjectUsers` — one fetch per page rather than a
 * joined user object per comment, which is the same call it already makes to
 * resolve the actors of the history events it interleaves these with.
 */
export const questCommentResourceSchema = questComments.schema.extend({
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
