import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, ForbiddenError, okSchema } from "alepha/server";
import { questComments } from "../entities/questComments.ts";
import { quests } from "../entities/quests.ts";
import { questCommentResourceSchema } from "../schemas/questCommentResourceSchema.ts";
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
        orderBy: [{ column: "createdAt", direction: "desc" }],
        limit: query?.limit ?? 200,
      });

      return rows.reverse();
    },
  });

  createQuestComment = $action({
    use: [$secure({ permissions: ["quest:update"] })],
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        body: z.string().min(1).meta({ size: "rich" }),
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
