import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, ForbiddenError, okSchema } from "alepha/server";

import { questComments } from "../entities/questComments.ts";
import { quests } from "../entities/quests.ts";
import { questCommentResourceSchema } from "../schemas/questCommentResourceSchema.ts";
import { questCommentSourceSchema } from "../schemas/questCommentSourceSchema.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

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
 */
export class QuestCommentController {
  comments = $repository(questComments);
  quests = $repository(quests);
  security = $inject(ProjectSecurityService);
  dt = $inject(DateTimeProvider);

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
    use: [$secure({ permissions: ["quest:read"] })],
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
    handler: async ({ params, query, user }) => {
      const quest = await this.quests.getById(params.id);
      await this.security.assertMember(quest.projectId, user);

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
    use: [$secure({ permissions: ["quest:update"] })],
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
    handler: async ({ params, body, user }) => {
      const quest = await this.quests.getById(params.id);
      await this.security.assertMember(quest.projectId, user);

      return await this.comments.create({
        questId: quest.id,
        authorId: user.id,
        body: body.body,
        source: body.source,
      });
    },
  });

  updateQuestComment = $action({
    use: [$secure({ permissions: ["quest:update"] })],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        body: z.string().min(1).meta({ size: "rich" }),
      }),
      response: questCommentResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const comment = await this.comments.getById(params.id);
      const quest = await this.quests.getById(comment.questId);
      await this.security.assertMember(quest.projectId, user);

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
    use: [$secure({ permissions: ["quest:update"] })],
    schema: {
      params: z.object({ id: z.integer() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const comment = await this.comments.getById(params.id);
      const quest = await this.quests.getById(comment.questId);
      const { project } = await this.security.assertMember(
        quest.projectId,
        user,
      );

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
