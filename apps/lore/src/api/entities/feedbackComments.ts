import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { questCommentSourceSchema } from "../schemas/questCommentSourceSchema.ts";
import { feedback } from "./feedback.ts";
import { users } from "./users.ts";

/**
 * One comment on a feedback item.
 *
 * Triage used to be a verdict with nowhere to put the reasoning: an owner
 * (or an agent) could accept or reject an item but could not ask its
 * reporter a question, and a finding like "reproduced on Safari only" had
 * to live on a quest that might never be created.
 *
 * A copy of `quest_comments` in shape, with one difference that is not
 * cosmetic: **the reporter is often not a project member**. They reach
 * their own item through `/account/feedback`, so the read/write gate here
 * is "member of the project OR the reporter of this item", not membership
 * alone. See `FeedbackCommentController`.
 *
 * **No notifications**, the same decision quest comments took: a comment
 * creates the expectation that someone is told, and that is Notifications
 * v2 (epic #6). The thread exists so the answer is there when they come
 * back.
 */
export const feedbackComments = $entity({
  name: "feedback_comments",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    /**
     * Cascade: a deleted feedback item takes its thread with it. There is
     * nothing to keep, and unlike `quests` this table is new, so it adds no
     * cascade child to an existing parent that a migration might rebuild.
     */
    feedbackId: db.ref(z.integer(), () => feedback.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * The author, or `null` once they delete their account. Set-null rather
     * than cascade for the same reason as `quest_comments.authorId`: erasing
     * one side of a conversation other people are still reading is not what
     * "delete my account" should mean. The feed renders a tombstone.
     *
     * `.optional()` sits INSIDE `db.ref` on purpose: outside it, no foreign
     * key is generated at all, silently.
     */
    authorId: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    body: z.string().meta({ size: "rich" }),
    /**
     * Set on every edit after the first save, so the thread can say
     * "edited" honestly. `updatedAt` cannot: the ORM stamps it on any write.
     */
    editedAt: z.datetime().optional(),
    /**
     * Provenance, carried from day one rather than retrofitted the way
     * `quest_comments.source` had to be. Absent means a human typed it.
     * See `questCommentSourceSchema`.
     */
    source: questCommentSourceSchema.optional(),
  }),
  indexes: [{ columns: ["feedbackId", "createdAt"] }],
});

export type FeedbackComment = Infer<typeof feedbackComments.schema>;
