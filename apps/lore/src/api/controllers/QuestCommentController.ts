import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { OwnedResourceProvider, $secure } from "alepha/security";
import { $action, ForbiddenError, okSchema } from "alepha/server";

import type { Project } from "../entities/projects.ts";
import { type QuestComment, questComments } from "../entities/questComments.ts";
import { type Quest, quests } from "../entities/quests.ts";
import { questCommentResourceSchema } from "../schemas/questCommentResourceSchema.ts";
import { questCommentSourceSchema } from "../schemas/questCommentSourceSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";

/**
 * The Discussion half of a quest: human comments, which the quest page
 * interleaves with the quest's own history events into one feed.
 *
 * **Its own controller, and its own endpoint rather than a field on
 * `getQuestLine`.** Two reasons, and the second is the deciding one:
 * a discussion grows without bound while a questline is two or three rows,
 * so the list needs a `limit` of its own; and `quest_comment_add` /
 * `quest_get` over MCP have to reach the same data, where `getQuestLine`
 * is not exposed at all. One transport, two consumers.
 *
 * Gates: reading and commenting need project membership, editing is the
 * author's alone, deleting is the author's or the project owner's. Same
 * `quest:*` permission strings as `QuestController` — a comment is not a
 * separate resource as far as the realm is concerned.
 *
 * `$ownsProject` covers the membership half and nothing more. The author
 * rules below it are about the COMMENT, not the quest, and no gate expresses
 * them.
 */
export class QuestCommentController {
  comments = $repository(questComments);
  quests = $repository(quests);
  dt = $inject(DateTimeProvider);
  owned = $inject(OwnedResourceProvider);

  /**
   * Member gate on the project the quest named by `params.id` belongs to.
   * Used where the route names the quest.
   */
  protected ownsQuest = () =>
    $ownsProject({ repository: () => this.quests, param: "id" });

  /**
   * Member gate reached from a COMMENT id, which takes two hops: a comment
   * references a quest, and only the quest references the project.
   *
   * This is the one place in the app that needs a chain, and it is why
   * `$owns` grew one. Denormalising `projectId` onto `quest_comments` would
   * be the alternative, and it is not one: the table hangs off a CASCADE
   * parent, so a rebuild of it on D1 is the expensive kind of migration.
   */
  protected ownsComment = () =>
    $ownsProject({
      repository: () => this.comments,
      param: "id",
      hops: [{ column: "questId", repository: () => this.quests }],
    });

  /**
   * Comment counts and the newest comment stamp for a page of quests, in
   * one query rather than one per quest.
   *
   * Lives here, next to the repository that owns the table, because two
   * surfaces want the same two numbers: MCP's `quest_list` (an agent
   * needs to know a row moved before it writes back over someone) and,
   * later, the quest table in the UI. A plain method rather than an
   * `$action`: it carries no gate of its own, so every caller must have
   * already proven membership on the project the quests belong to, which
   * is exactly what listing them required.
   *
   * Returns nothing for a quest with no comments; callers read a missing
   * entry as zero rather than storing a row of zeroes per quest.
   */
  async commentStatsFor(
    questIds: readonly number[],
  ): Promise<Map<number, { count: number; lastAt: string }>> {
    const stats = new Map<number, { count: number; lastAt: string }>();
    if (questIds.length === 0) {
      return stats;
    }

    const rows = await this.comments.findMany({
      where: { questId: { inArray: [...questIds] } },
      columns: ["questId", "createdAt"],
    });

    for (const row of rows) {
      const current = stats.get(row.questId);
      if (!current) {
        stats.set(row.questId, { count: 1, lastAt: row.createdAt });
        continue;
      }
      current.count += 1;
      // Parsed rather than compared as strings: the column is an ISO
      // datetime, and nothing in the schema pins the offset to `Z`.
      if (Date.parse(row.createdAt) > Date.parse(current.lastAt)) {
        current.lastAt = row.createdAt;
      }
    }

    return stats;
  }

  listQuestComments = $action({
    use: [$secure({ permissions: ["quest:read"] }), this.ownsQuest()],
    schema: {
      params: z.object({ id: z.integer() }),
      query: z.object({
        /**
         * Oldest-first is the reading order of a conversation, so this caps
         * the TAIL: the most recent `limit` comments. A quest that ever
         * carries hundreds is the day this grows a cursor.
         */
        limit: z.integer().min(1).max(200).optional(),
      }),
      response: z.array(questCommentResourceSchema),
    },
    handler: async ({ params, query }) => {
      const rows = await this.comments.findMany({
        where: { questId: { eq: params.id } },
        // `id` breaks the tie, and it is not decoration: `createdAt` has
        // millisecond resolution, so a burst of comments (an agent posting
        // several in a loop, most obviously) lands several rows on the same
        // stamp and the tail this takes would be an arbitrary subset of them.
        orderBy: [
          { column: "createdAt", direction: "desc" },
          { column: "id", direction: "desc" },
        ],
        limit: query?.limit ?? 200,
      });

      return rows.toReversed();
    },
  });

  createQuestComment = $action({
    use: [$secure({ permissions: ["quest:update"] }), this.ownsQuest()],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        body: z.string().min(1).meta({ size: "rich" }),
        /**
         * Set by `QuestTools.quest_comment_add` and by nothing else. The web
         * client never sends it, so a comment with no `source` is one a
         * human typed. See `questCommentSourceSchema` for why this is not
         * derived from the credential the caller authenticated with.
         */
        source: questCommentSourceSchema.optional(),
      }),
      response: questCommentResourceSchema,
    },
    handler: async ({ body, user }) => {
      const quest = this.owned.get<Quest>();

      return await this.comments.create({
        questId: quest.id,
        authorId: user.id,
        body: body.body,
        source: body.source,
      });
    },
  });

  updateQuestComment = $action({
    use: [$secure({ permissions: ["quest:update"] }), this.ownsComment()],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        body: z.string().min(1).meta({ size: "rich" }),
      }),
      response: questCommentResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const comment = this.owned.get<QuestComment>();

      // Editing is the author's alone — not the owner's. An owner rewriting
      // what someone else said, under their name, is a different feature
      // from moderation, and not one anybody asked for.
      if (comment.authorId !== user.id) {
        throw new ForbiddenError("Only the author can edit this comment");
      }

      return await this.comments.updateById(params.id, {
        body: body.body,
        editedAt: this.dt.nowISOString(),
      });
    },
  });

  deleteQuestComment = $action({
    use: [$secure({ permissions: ["quest:update"] }), this.ownsComment()],
    schema: {
      params: z.object({ id: z.integer() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const comment = this.owned.get<QuestComment>();
      // `project.createdBy` directly rather than an owner-variant gate: the
      // privileged-identity bypass (`user.ownership === false`) must NOT
      // apply to deleting somebody's words, and an owner gate would grant it.
      const project = this.owned.authority<Project>();

      // Deleting IS moderation, so the project owner may do it too.
      if (comment.authorId !== user.id && project.createdBy !== user.id) {
        throw new ForbiddenError(
          "Only the author or the project owner can delete this comment",
        );
      }

      await this.comments.deleteById(params.id);
      return { ok: true };
    },
  });
}
