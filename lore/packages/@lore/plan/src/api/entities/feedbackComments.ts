import { commentSourceSchema, users } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { feedback } from "./feedback.ts";

/**
 * ⚠️ RETIRED (#E185): the table a feedback item's thread lived in until the
 * comments moved to core's `comments` (subject `feedback`). Nothing reads or
 * writes it any more.
 *
 * Still declared, and only that, for the reason `questComments` gives: the
 * table is still on disk. Its rows were copied by
 * `20261126215004_feedback_comments_to_comments`, and one later migration drops it once the
 * counts are compared on production (review of #E185, item 26). Registered
 * by `RetiredCommentTables` so the snapshot and the migration safety spec
 * still hold it; `feedback` stays its cascade parent until then.
 *
 * Do not import it: a comment is a row of `comments`, written through
 * `CommentService`.
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
     * File ids, uploaded through `POST /projects/:id/feedback/attachments`
     * like the item's own, so a reporter answering "which browser?" can
     * paste the screenshot instead of describing it. A `uuid[]`, mirroring
     * `feedback.attachments`.
     */
    attachments: db.default(z.array(z.uuid()), []),
    /**
     * Set on every edit after the first save, so the thread can say
     * "edited" honestly. `updatedAt` cannot: the ORM stamps it on any write.
     */
    editedAt: z.datetime().optional(),
    /**
     * Provenance, carried from day one rather than retrofitted the way
     * `quest_comments.source` had to be. Absent means a human typed it.
     * See `commentSourceSchema`.
     */
    source: commentSourceSchema.optional(),
  }),
  indexes: [{ columns: ["feedbackId", "createdAt"] }],
});

export type FeedbackComment = Infer<typeof feedbackComments.schema>;
