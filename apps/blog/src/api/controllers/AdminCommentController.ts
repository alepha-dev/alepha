import { $inject, t } from "alepha";
import { $action, okSchema } from "alepha/server";
import { commentStatusSchema as commentStatusEnum } from "../entities/commentEntity.ts";
import {
  commentQuerySchema,
  commentResourceSchema,
} from "../schemas/commentSchemas.ts";
import { CommentService } from "../services/CommentService.ts";

/**
 * Admin comment moderation endpoints.
 */
export class AdminCommentController {
  protected readonly url = "/admin/comments";
  protected readonly group = "admin:comments";
  protected readonly commentService = $inject(CommentService);

  /**
   * GET /admin/comments - List all comments with filters.
   */
  public readonly findComments = $action({
    path: this.url,
    group: this.group,
    description: "List all comments for admin",
    schema: {
      query: commentQuerySchema,
      response: t.page(commentResourceSchema),
    },
    handler: ({ query }) => this.commentService.findAll(query),
  });

  /**
   * PATCH /admin/comments/:id - Update comment status.
   */
  public readonly updateComment = $action({
    method: "PATCH",
    path: `${this.url}/:id`,
    group: this.group,
    description: "Update comment status",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: t.object({ status: commentStatusEnum }),
      response: commentResourceSchema,
    },
    handler: ({ params, body }) =>
      this.commentService.updateStatus(params.id, body.status) as any,
  });

  /**
   * DELETE /admin/comments/:id - Delete a comment.
   */
  public readonly deleteComment = $action({
    method: "DELETE",
    path: `${this.url}/:id`,
    group: this.group,
    description: "Delete a comment",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.commentService.delete(params.id);
      return { ok: true as const };
    },
  });
}
