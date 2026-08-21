import { $inject, z } from "alepha";
import { users } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { $secure, type UserAccountToken } from "alepha/security";
import {
  $action,
  ForbiddenError,
  NotFoundError,
  okSchema,
} from "alepha/server";
// The helper the UI labels a user with, so a name reads identically in a
// thread and on the rest of the page. Same precedent as `ProjectController`.
import { displayName } from "../../web/app/services/displayName.ts";
import { feedback } from "../entities/feedback.ts";
import { feedbackComments } from "../entities/feedbackComments.ts";
import { projects } from "../entities/projects.ts";
import { feedbackCommentResourceSchema } from "../schemas/feedbackCommentResourceSchema.ts";
import { questCommentSourceSchema } from "../schemas/questCommentSourceSchema.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

/**
 * The thread on a feedback item: the owner asking the reporter a question,
 * the reporter answering, and triage findings that would otherwise have
 * nowhere to live but a quest nobody has created yet.
 *
 * **Its own controller, mirroring `QuestCommentController`**, and gated
 * differently from every other feedback endpoint. Reading and writing needs
 * project membership OR being the reporter of THIS item: a reporter is
 * usually not a member, and an answer they cannot post is not a
 * conversation. Editing is the author's alone; deleting is the author's or
 * the project owner's, because deleting is moderation.
 *
 * **No notifications.** Same decision as quest comments, and the reason it
 * matters more here: a reporter is not sitting in the project. The thread is
 * there when they come back, and the UI copy says so rather than implying a
 * reply is on its way.
 */
export class FeedbackCommentController {
  comments = $repository(feedbackComments);
  feedback = $repository(feedback);
  users = $repository(users);
  projects = $repository(projects);
  security = $inject(ProjectSecurityService);
  dt = $inject(DateTimeProvider);

  /**
   * How many comments a thread hands out at once. The tail, not the head:
   * the recent end of a conversation is the part that still matters.
   */
  protected readonly cap = 200;

  /**
   * Load the feedback item, proving the caller may see its thread.
   *
   * Two ways in, and the order is deliberate: membership first because it
   * is the common case, then the reporter check. A stranger gets a 404
   * rather than a 403, the same way `loadMyFeedback` does, so an id probe
   * learns nothing about what exists.
   */
  /**
   * Attach display names to a page of comments, in one lookup for the
   * distinct authors rather than one per row.
   */
  protected async withAuthors<T extends { authorId?: string }>(
    rows: T[],
  ): Promise<Array<T & { authorName?: string }>> {
    const ids = [...new Set(rows.map((row) => row.authorId).filter(Boolean))];
    const people = ids.length
      ? await this.users.findMany({
          where: { id: { inArray: ids as string[] } },
          columns: ["id", "username", "email"],
        })
      : [];

    return rows.map((row) => ({
      ...row,
      authorName: row.authorId
        ? displayName(
            people.find((person) => person.id === row.authorId),
            row.authorId,
          )
        : undefined,
    }));
  }

  protected async loadReadable(feedbackId: number, user: UserAccountToken) {
    const row = await this.feedback.findOne({
      where: { id: { eq: feedbackId } },
    });
    if (!row) {
      throw new NotFoundError("Feedback not found");
    }

    if (row.reporterUserId === user.id) {
      return row;
    }
    if (await this.security.isMember(row.projectId, user)) {
      return row;
    }
    throw new NotFoundError("Feedback not found");
  }

  listFeedbackComments = $action({
    use: [$secure()],
    method: "GET",
    path: "/feedback/:id/comments",
    schema: {
      params: z.object({ id: z.integer() }),
      query: z.object({
        limit: z.integer().min(1).max(200).optional(),
      }),
      response: z.array(feedbackCommentResourceSchema),
    },
    handler: async ({ params, query, user }) => {
      await this.loadReadable(params.id, user);

      const rows = await this.comments.findMany({
        where: { feedbackId: { eq: params.id } },
        // `id` breaks the tie for the same reason as on quest comments:
        // `createdAt` is millisecond-resolution, so a burst lands several
        // rows on one stamp and the tail would otherwise be an arbitrary
        // subset of them.
        orderBy: [
          { column: "createdAt", direction: "desc" },
          { column: "id", direction: "desc" },
        ],
        limit: query?.limit ?? this.cap,
      });

      return await this.withAuthors(rows.reverse());
    },
  });

  createFeedbackComment = $action({
    use: [$secure()],
    method: "POST",
    path: "/feedback/:id/comments",
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        body: z.string().min(1).meta({ size: "rich" }),
        /**
         * Set by `FeedbackTools.feedback_comment_add` and nothing else. The
         * web client never sends it, so an absent `source` means a human
         * typed it.
         */
        source: questCommentSourceSchema.optional(),
      }),
      response: feedbackCommentResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const row = await this.loadReadable(params.id, user);

      const created = await this.comments.create({
        feedbackId: row.id,
        authorId: user.id,
        body: body.body,
        source: body.source,
      });
      const [resource] = await this.withAuthors([created]);
      return resource;
    },
  });

  updateFeedbackComment = $action({
    use: [$secure()],
    method: "PATCH",
    path: "/feedback/comments/:id",
    schema: {
      params: z.object({ id: z.integer() }),
      body: z.object({
        body: z.string().min(1).meta({ size: "rich" }),
      }),
      response: feedbackCommentResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const comment = await this.comments.getById(params.id);
      await this.loadReadable(comment.feedbackId, user);

      // Editing is the author's alone, not the owner's. An owner rewriting
      // what a reporter said, under their name, is a different feature from
      // moderation.
      if (comment.authorId !== user.id) {
        throw new ForbiddenError("Only the author can edit this comment");
      }

      const updated = await this.comments.updateById(params.id, {
        body: body.body,
        editedAt: this.dt.nowISOString(),
      });
      const [resource] = await this.withAuthors([updated]);
      return resource;
    },
  });

  deleteFeedbackComment = $action({
    use: [$secure()],
    method: "DELETE",
    path: "/feedback/comments/:id",
    schema: {
      params: z.object({ id: z.integer() }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const comment = await this.comments.getById(params.id);
      const row = await this.loadReadable(comment.feedbackId, user);

      // Deleting IS moderation, so the project owner may do it too. The
      // reporter cannot delete the owner's questions on their own item.
      //
      // Compared against `createdBy` directly rather than through
      // `assertOwner`, which also lets a privileged identity
      // (`user.ownership === false`) through. That escape hatch is for
      // administration, and it must not be the reason a reporter with an
      // unusual token can delete the owner's question. Same explicit check
      // `QuestCommentController.deleteQuestComment` makes.
      if (comment.authorId !== user.id) {
        const project = await this.projects.getOne({
          where: { id: { eq: row.projectId } },
        });
        if (project.createdBy !== user.id) {
          throw new ForbiddenError(
            "Only the author or the project owner can delete this comment",
          );
        }
      }

      await this.comments.deleteById(params.id);
      return { ok: true };
    },
  });
}
