import { $inject, t } from "alepha";
import { $action, okSchema } from "alepha/server";
import {
  dashboardStatsSchema,
  postCreateSchema,
  postQuerySchema,
  postResourceSchema,
  postUpdateSchema,
} from "../schemas/postSchemas.ts";
import { PostService } from "../services/PostService.ts";

/**
 * Admin post management endpoints.
 * All endpoints require authentication and admin permissions.
 */
export class AdminPostController {
  protected readonly url = "/admin/posts";
  protected readonly group = "admin:posts";
  protected readonly postService = $inject(PostService);

  /**
   * GET /admin/posts - List all posts (any status).
   */
  public readonly findPosts = $action({
    path: this.url,
    group: this.group,
    description: "List all posts for admin",
    schema: {
      query: postQuerySchema,
      response: t.page(postResourceSchema),
    },
    handler: ({ query }) => this.postService.findAll(query),
  });

  /**
   * POST /admin/posts - Create a new post.
   */
  public readonly createPost = $action({
    method: "POST",
    path: this.url,
    group: this.group,
    description: "Create a new blog post",
    schema: {
      body: postCreateSchema,
      response: postResourceSchema,
    },
    handler: ({ body, user }) => this.postService.create(body, user!.id) as any,
  });

  /**
   * GET /admin/posts/:id - Get a single post by ID.
   */
  public readonly getPost = $action({
    path: `${this.url}/:id`,
    group: this.group,
    description: "Get a post by ID",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: postResourceSchema,
    },
    handler: async ({ params }) => {
      const post = await this.postService.findById(params.id);
      if (!post) throw new Error("Post not found");
      return post as any;
    },
  });

  /**
   * PATCH /admin/posts/:id - Update a post.
   */
  public readonly updatePost = $action({
    method: "PATCH",
    path: `${this.url}/:id`,
    group: this.group,
    description: "Update a blog post",
    schema: {
      params: t.object({ id: t.uuid() }),
      body: postUpdateSchema,
      response: postResourceSchema,
    },
    handler: ({ params, body }) =>
      this.postService.update(params.id, body) as any,
  });

  /**
   * DELETE /admin/posts/:id - Delete a post.
   */
  public readonly deletePost = $action({
    method: "DELETE",
    path: `${this.url}/:id`,
    group: this.group,
    description: "Delete a blog post",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      await this.postService.delete(params.id);
      return { ok: true as const };
    },
  });

  /**
   * POST /admin/posts/:id/publish - Publish a post.
   */
  public readonly publishPost = $action({
    method: "POST",
    path: `${this.url}/:id/publish`,
    group: this.group,
    description: "Publish a blog post",
    schema: {
      params: t.object({ id: t.uuid() }),
      response: postResourceSchema,
    },
    handler: ({ params }) => this.postService.publish(params.id) as any,
  });

  /**
   * GET /admin/stats - Dashboard statistics.
   */
  public readonly getDashboardStats = $action({
    path: "/admin/stats",
    group: this.group,
    description: "Get blog dashboard statistics",
    schema: {
      response: dashboardStatsSchema,
    },
    handler: () => this.postService.getStats() as any,
  });
}
