import { commentSourceSchema, users } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { quests } from "./quests.ts";

/**
 * ⚠️ RETIRED (#E185): the table a quest's discussion lived in until the
 * comments moved to core's `comments` (subject `quest`). Nothing reads or
 * writes it any more.
 *
 * It is still declared, and only that, for one reason: the table is still
 * on disk. Its rows were copied by
 * `20261126215003_quest_comments_to_comments`, and the owner decided (review
 * of #E185, item 26) that the old table stays untouched until the counts are
 * compared on production, when one later migration drops it with
 * `feedback_comments` and `requirements_comments`. While the entity is
 * registered (`RetiredCommentTables`), the table stays in the migration
 * snapshot and stays guarded by `apps/lore/test/migration-safety.spec.ts`;
 * deleting this file is what generates that drop, which then needs its
 * `-- alepha-allow-drop-table:` marker and its `SANCTIONED_DROPS` entry.
 *
 * Do not import it: a comment is a row of `comments`, written through
 * `CommentService`.
 */
export const questComments = $entity({
  name: "quest_comments",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    /**
     * Cascade: a deleted quest takes its discussion with it. There is
     * nothing to keep — a comment with no quest is unreachable from every
     * surface that reads one.
     *
     * ⚠️ This makes `quests` a CASCADE parent, which is why quest #1254's
     * `DROP COLUMN difficulty` had to land BEFORE this table existed: on D1
     * a table rebuild of `quests` fires this cascade against the freshly
     * copied rows. Any future migration that rebuilds `quests` now wipes
     * the discussion. See `apps/lore/AGENTS.md` → "Migration safety on D1".
     */
    questId: db.ref(z.integer(), () => quests.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * The author, or `null` once they delete their account.
     *
     * **Set-null, deliberately not cascade.** `UserDeletionHook` refuses
     * account deletion to project *owners* only, so a plain member can
     * delete their account — and a cascade there would silently erase every
     * comment they ever left, taking half of a conversation out of the
     * middle of a thread that other people are still reading. The feed
     * renders a tombstone author instead.
     *
     * `.optional()` sits INSIDE `db.ref` on purpose: outside it, no foreign
     * key is generated at all, silently, and the migration snapshot check
     * cannot catch it.
     */
    authorId: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    body: z.string().meta({ size: "rich" }),
    /**
     * Set on every edit after the first save, so the feed can say "edited"
     * honestly. `updatedAt` cannot: the ORM stamps it on any write.
     */
    editedAt: z.datetime().optional(),
    /**
     * Provenance, set only when a machine wrote the comment. Absent means a
     * human typed it in the UI. See `commentSourceSchema`.
     *
     * ⚠️ Optional with NO `db.default(...)`, so the migration is a plain
     * additive `ALTER TABLE ADD COLUMN`. A column DEFAULT triggers a table
     * rebuild on D1. This table has no cascade children today, but the habit
     * is what keeps the next one from being the expensive one.
     */
    source: commentSourceSchema.optional(),
    /**
     * File ids, uploaded through `POST /quests/attachments` by the author.
     * The COMMENT's files, not the quest's: a screenshot posted in the
     * thread stays with the message it answers, as on a feedback comment.
     *
     * ⚠️ Optional with no `db.default(...)`, for the reason `source` has
     * none: a column DEFAULT is a table rebuild on D1.
     */
    attachments: z.array(z.uuid()).optional(),
  }),
  indexes: [
    /**
     * The activity feed's window scan
     * (`ProjectActivityService.commentEvents`), which filters on
     * `createdAt` and joins the quest afterwards to scope it to a project.
     * `createdAt` therefore has to lead: an index on `questId` would not
     * be reachable from that predicate.
     *
     * ⚠️ This table had NO index at all before, not even on `questId`, so
     * the feed's comment read was a full table scan. Invisible at the 98
     * rows production holds, and this is the table that grows with every
     * agent comment on every quest, forever.
     *
     * The per-quest thread read wants `(questId, createdAt)` and still has
     * nothing. Deliberately left alone: it is a different query with a
     * different leading column, and it is not what this quest is about.
     */
    { columns: ["createdAt"] },
  ],
});

export type QuestComment = Infer<typeof questComments.schema>;
