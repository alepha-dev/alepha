import { $inject, t } from "alepha";
import { $action } from "alepha/server";
import {
  commentCreateSchema,
  commentQuerySchema,
  commentResourceSchema,
} from "../schemas/commentSchemas.ts";
import { CommentService } from "../services/CommentService.ts";

/**
 * Public and authenticated user comment endpoints.
 */
export class CommentController {
  protected readonly group = "comments";
  protected readonly commentService = $inject(CommentService);

  /**
   * GET /posts/:postId/comments - List approved comments for a post.
   */
  public readonly listComments = $action({
    path: "/posts/:postId/comments",
    group: this.group,
    description: "List approved comments for a post",
    schema: {
      params: t.object({ postId: t.uuid() }),
      query: commentQuerySchema,
      response: t.page(commentResourceSchema),
    },
    handler: ({ params, query }) =>
      this.commentService.findByPost(params.postId, query),
  });

  /**
   * POST /posts/:postId/comments - Create a comment (authenticated users only).
   */
  public readonly createComment = $action({
    method: "POST",
    path: "/posts/:postId/comments",
    group: this.group,
    secure: true,
    description: "Create a comment on a post",
    schema: {
      params: t.object({ postId: t.uuid() }),
      body: commentCreateSchema,
      response: commentResourceSchema,
    },
    handler: ({ params, body, user }) =>
      this.commentService.create(params.postId, user!.id, body) as any,
  });
}
