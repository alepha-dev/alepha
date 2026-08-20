import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { quests } from "./quests.ts";
import { users } from "./users.ts";

/**
 * One comment on a quest.
 *
 * Comments interleave with the quest's own history events into a single
 * Discussion feed — never a second list. Agents read and write them over
 * MCP, which is the point of the feature: the owner leaves "do X
 * differently" on a quest, and the next session sees it.
 *
 * **No notifications.** Decided before the table existed: comments create an
 * expectation that someone is told, and that is a separate feature which
 * should not be bundled while Lore is small-team.
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
     * the discussion. See `apps/lore/CLAUDE.md` → "Migration safety on D1".
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
  }),
});

export type QuestComment = Infer<typeof questComments.schema>;
