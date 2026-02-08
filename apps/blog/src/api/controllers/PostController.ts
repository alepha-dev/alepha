import { $inject, t } from "alepha";
import { $action } from "alepha/server";
import { postQuerySchema, postResourceSchema } from "../schemas/postSchemas.ts";
import { PostService } from "../services/PostService.ts";

/**
 * Public blog post endpoints.
 * No authentication required for reading published posts.
 */
export class PostController {
  protected readonly url = "/posts";
  protected readonly group = "posts";
  protected readonly postService = $inject(PostService);

  /**
   * GET /posts - List published posts with optional filters.
   */
  public readonly listPublishedPosts = $action({
    path: this.url,
    group: this.group,
    description: "List published blog posts",
    schema: {
      query: postQuerySchema,
      response: t.page(postResourceSchema),
    },
    handler: ({ query }) => this.postService.findPublished(query),
  });

  /**
   * GET /posts/featured - List featured published posts.
   */
  public readonly getFeaturedPosts = $action({
    path: `${this.url}/featured`,
    group: this.group,
    description: "List featured blog posts",
    schema: {
      response: t.array(postResourceSchema),
    },
    handler: () => this.postService.findFeatured() as any,
  });

  /**
   * GET /posts/:slug - Get a single published post by slug.
   */
  public readonly getPostBySlug = $action({
    path: `${this.url}/:slug`,
    group: this.group,
    description: "Get a published post by slug",
    schema: {
      params: t.object({ slug: t.text() }),
      response: postResourceSchema,
    },
    handler: async ({ params }) => {
      const post = await this.postService.findBySlug(params.slug);
      if (!post) {
        throw new Error("Post not found");
      }
      await this.postService.incrementViews(post.id);
      return post as any;
    },
  });
}
