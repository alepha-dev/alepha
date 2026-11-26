import { $ownsProject, CommentService } from "@lore/core/api";
import {
  type Comment,
  commentSourceSchema,
  type Project,
} from "@lore/core/schemas";
import { $inject, z } from "alepha";
import { OwnedResourceProvider, type UserAccountToken } from "alepha/security";
import {
  $action,
  BadRequestError,
  ForbiddenError,
  okSchema,
} from "alepha/server";

import { projectErrorThreadEntrySchema } from "../schemas/projectErrorThreadEntrySchema.ts";
import { ProjectErrorAccess } from "../services/ProjectErrorAccess.ts";
import { ProjectErrorThread } from "../services/ProjectErrorThread.ts";

/**
 * An error's thread (#E185): the comments members and agents write on it,
 * and its triage events, read as one feed.
 *
 * - **`error:read` reads and writes a comment**, as feedback does: the
 *   questions that come before a quest (noise or real, which deploy) belong
 *   to whoever reads the inbox. The triage verbs stay on `error:triage`, in
 *   `ProjectErrorController`.
 * - **An agent reads and writes only on a trusted error**: the same refusal
 *   as every other read of one. A member's comment is not gated.
 * - **A comment is the member's or the agent's markdown.** Nothing here
 *   copies the error's `name`, `message`, `stack` or `sourceUrl` into a
 *   body or an event: that text comes from an application's runtime.
 */
export class ProjectErrorThreadController {
  protected readonly access = $inject(ProjectErrorAccess);
  protected readonly thread = $inject(ProjectErrorThread);
  protected readonly comments = $inject(CommentService);
  protected readonly owned = $inject(OwnedResourceProvider);

  listProjectErrorThread = $action({
    use: [$ownsProject({ requires: "error:read", param: "projectId" })],
    method: "GET",
    path: "/projects/:projectId/errors/:errorId/thread",
    schema: {
      params: z.object({
        projectId: z.integer(),
        errorId: z.integer(),
      }),
      response: z.object({
        entries: z.array(projectErrorThreadEntrySchema),
      }),
    },
    handler: async ({ params, user }) => {
      const error = await this.access.load(params.projectId, params.errorId);
      await this.access.assertAgentMayRead(error, user);
      const quests = await this.access.questsReadable(
        this.owned.authority<Project>(),
        user,
      );
      return { entries: await this.thread.list(error, { quests }) };
    },
  });

  createProjectErrorComment = $action({
    use: [
      $ownsProject({
        requires: "error:read",
        param: "projectId",
        capability: { key: "ship", action: "comment on an error" },
      }),
    ],
    method: "POST",
    path: "/projects/:projectId/errors/:errorId/comments",
    schema: {
      params: z.object({
        projectId: z.integer(),
        errorId: z.integer(),
      }),
      body: z.object({
        body: z.string().min(1).meta({ size: "rich" }),
        /**
         * Set by `error_comment_add` and by `lore error comment --as`, and
         * by nothing else: a comment with no `source` is one a person typed.
         */
        source: commentSourceSchema.optional(),
      }),
      response: projectErrorThreadEntrySchema,
    },
    handler: async ({ params, body, user }) => {
      const error = await this.access.load(params.projectId, params.errorId);
      await this.access.assertAgentMayRead(error, user);
      if (!body.body.trim()) {
        throw new BadRequestError("A comment needs a body");
      }
      const comment = await this.comments.add({
        type: ProjectErrorThread.SUBJECT,
        projectId: params.projectId,
        subjectId: error.id,
        authorId: user.id,
        body: body.body,
        source: body.source,
      });
      return await this.thread.entryOf(comment);
    },
  });

  updateProjectErrorComment = $action({
    use: [
      $ownsProject({
        requires: "error:read",
        param: "projectId",
        capability: { key: "ship", action: "edit a comment on an error" },
      }),
    ],
    method: "PATCH",
    path: "/projects/:projectId/errors/:errorId/comments/:commentId",
    schema: {
      params: z.object({
        projectId: z.integer(),
        errorId: z.integer(),
        commentId: z.integer(),
      }),
      body: z.object({
        body: z.string().min(1).meta({ size: "rich" }),
      }),
      response: projectErrorThreadEntrySchema,
    },
    handler: async ({ params, body, user }) => {
      const comment = await this.own(params, user);
      if (!body.body.trim()) {
        throw new BadRequestError("A comment needs a body");
      }
      const updated = await this.comments.edit(comment.id, {
        body: body.body,
      });
      return await this.thread.entryOf(updated);
    },
  });

  deleteProjectErrorComment = $action({
    use: [
      $ownsProject({
        requires: "error:read",
        param: "projectId",
        capability: { key: "ship", action: "delete a comment on an error" },
      }),
    ],
    method: "DELETE",
    path: "/projects/:projectId/errors/:errorId/comments/:commentId",
    schema: {
      params: z.object({
        projectId: z.integer(),
        errorId: z.integer(),
        commentId: z.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const comment = await this.own(params, user);
      await this.comments.remove(comment.id);
      return { ok: true };
    },
  });

  /**
   * The caller's own comment on this error of this project: the error is
   * loaded in its project first (the 404 across projects), the comment
   * through the error's thread (the 404 across threads), and only its
   * author may change it. Nobody rewrites or removes another member's words
   * here.
   */
  protected async own(
    params: { projectId: number; errorId: number; commentId: number },
    user: UserAccountToken,
  ): Promise<Comment> {
    const error = await this.access.load(params.projectId, params.errorId);
    await this.access.assertAgentMayRead(error, user);
    const comment = await this.comments.get(
      ProjectErrorThread.SUBJECT,
      error.id,
      params.commentId,
    );
    if (comment.authorId !== user.id) {
      throw new ForbiddenError("Only the author can change this comment");
    }
    return comment;
  }
}
