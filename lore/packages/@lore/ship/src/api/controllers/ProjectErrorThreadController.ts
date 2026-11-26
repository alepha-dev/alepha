import {
  $ownsProject,
  CommentService,
  MentionNotifier,
  type MentionSubject,
} from "@lore/core/api";
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

import type { ProjectError } from "../entities/projectErrors.ts";
import { projectErrorThreadEntrySchema } from "../schemas/projectErrorThreadEntrySchema.ts";
import { projectErrorThreadJobSchema } from "../schemas/projectErrorThreadJobSchema.ts";
import { ProjectErrorAccess } from "../services/ProjectErrorAccess.ts";
import { ProjectErrorKinds } from "../services/ProjectErrorKinds.ts";
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
 * - **`@name` reaches a member**, as in a quest's discussion, and the
 *   message names the error by its id and its kind, never by its text
 *   ({@link mentionSubject}).
 */
export class ProjectErrorThreadController {
  protected readonly access = $inject(ProjectErrorAccess);
  protected readonly thread = $inject(ProjectErrorThread);
  protected readonly comments = $inject(CommentService);
  protected readonly owned = $inject(OwnedResourceProvider);
  protected readonly mentions = $inject(MentionNotifier);
  protected readonly kinds = $inject(ProjectErrorKinds);

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
        /**
         * The agent runs on this error that have not answered (#Q4471).
         */
        jobs: z.array(projectErrorThreadJobSchema),
      }),
    },
    handler: async ({ params, user }) => {
      const error = await this.access.load(params.projectId, params.errorId);
      await this.access.assertAgentMayRead(error, user);
      const quests = await this.access.questsReadable(
        this.owned.authority<Project>(),
        user,
      );
      const [entries, jobs] = await Promise.all([
        this.thread.list(error, { quests }),
        this.thread.jobs(error),
      ]);
      return { entries, jobs };
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
      // After the write, and never thrown: a comment that saved does not
      // fail on a message. Over MCP the author is the key's owner, so only
      // `source` says an agent wrote it, and only then may its own owner be
      // reached (#Q2348).
      await this.mentions.notify({
        subject: this.mentionSubject(error),
        authorId: user.id,
        body: body.body,
        agent:
          body.source?.kind === "mcp"
            ? { client: body.source.client }
            : undefined,
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
      // Only the handles the edit added: fixing a typo re-pings nobody.
      if (comment.body !== body.body) {
        await this.mentions.notify({
          subject: this.mentionSubject(
            await this.access.load(params.projectId, params.errorId),
          ),
          authorId: user.id,
          body: body.body,
          previousBody: comment.body,
        });
      }
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
   * Where a mention on this error points, and what it is called.
   *
   * ⚠️ **By its id and its kind, never by its text.** A quest's mention
   * carries the quest's title; an error's `name` and `message` are written
   * by whatever runs in a browser, so by anyone, and an inbox message (and
   * its e-mail) would carry them to a member unread and untrusted. An error
   * has no typed reference either: it is `Error 42`.
   */
  protected mentionSubject(error: ProjectError): MentionSubject {
    const project = this.owned.authority<Project>();
    const slug = project.slug || `project-${project.id}`;
    return {
      projectId: error.projectId,
      projectTitle: project.title,
      reference: `Error ${error.id}`,
      title: this.kinds.title(error),
      href: `/${slug}/errors/${error.id}`,
    };
  }

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
