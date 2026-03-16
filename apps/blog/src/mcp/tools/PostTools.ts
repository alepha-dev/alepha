import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $tool } from "alepha/mcp";
import { $repository } from "alepha/orm";
import { posts } from "../../api/entities/posts.ts";
import { MarkdownProvider } from "../../api/providers/MarkdownProvider.ts";
import { postCreateParamsSchema } from "../schemas/postCreateParamsSchema.ts";
import { postListParamsSchema } from "../schemas/postListParamsSchema.ts";
import { postPublishParamsSchema } from "../schemas/postPublishParamsSchema.ts";
import { postReadParamsSchema } from "../schemas/postReadParamsSchema.ts";
import { postUpdateParamsSchema } from "../schemas/postUpdateParamsSchema.ts";

export class PostTools {
  protected log = $logger();
  protected posts = $repository(posts);
  protected markdown = $inject(MarkdownProvider);
  protected dateTime = $inject(DateTimeProvider);

  post_list = $tool({
    description: "List blog posts. Filter by status (draft/published) or tag.",
    schema: { params: postListParamsSchema },
    handler: async ({ params }) => {
      const where: Record<string, any> = {};

      if (params.status === "published") {
        where.publishedAt = { isNotNull: true };
      } else if (params.status === "draft") {
        where.publishedAt = { isNull: true };
      }

      if (params.tag) {
        where.tags = { arrayContains: params.tag };
      }

      const results = await this.posts.findMany({
        where,
        orderBy: [{ column: "createdAt", direction: "desc" }],
      });

      return results.map((p) => ({
        slug: p.slug,
        title: p.title,
        summary: p.summary,
        tags: p.tags,
        publishedAt: p.publishedAt,
      }));
    },
  });

  post_read = $tool({
    description:
      "Read a blog post by slug. Returns markdown content (not HTML) for editing.",
    schema: { params: postReadParamsSchema },
    handler: async ({ params }) => {
      const post = await this.posts.getOne({
        where: { slug: { eq: params.slug } },
      });

      return {
        slug: post.slug,
        title: post.title,
        summary: post.summary,
        content: post.content,
        tags: post.tags,
        publishedAt: post.publishedAt,
      };
    },
  });

  post_create = $tool({
    description: "Create a new draft blog post.",
    schema: { params: postCreateParamsSchema },
    handler: async ({ params }) => {
      const contentHtml = this.markdown.render(params.content);

      const post = await this.posts.create({
        slug: params.slug,
        title: params.title,
        summary: params.summary,
        content: params.content,
        contentHtml,
        tags: params.tags ?? [],
        authorId: null as any,
      });

      return { slug: post.slug, title: post.title, id: post.id };
    },
  });

  post_update = $tool({
    description:
      "Update a blog post. Re-renders markdown to HTML automatically.",
    schema: { params: postUpdateParamsSchema },
    handler: async ({ params }) => {
      const post = await this.posts.getOne({
        where: { slug: { eq: params.slug } },
      });

      const update: Record<string, any> = {};
      if (params.title !== undefined) update.title = params.title;
      if (params.summary !== undefined) update.summary = params.summary;
      if (params.tags !== undefined) update.tags = params.tags;
      if (params.content !== undefined) {
        update.content = params.content;
        update.contentHtml = this.markdown.render(params.content);
      }

      const updated = await this.posts.updateOne(
        { id: { eq: post.id } },
        update as any,
      );
      return { slug: updated.slug, title: updated.title };
    },
  });

  post_publish = $tool({
    description: "Publish or unpublish a blog post.",
    schema: { params: postPublishParamsSchema },
    handler: async ({ params }) => {
      const post = await this.posts.getOne({
        where: { slug: { eq: params.slug } },
      });

      const updated = await this.posts.updateOne({ id: { eq: post.id } }, {
        publishedAt: params.publish ? this.dateTime.toISOString() : null,
      } as any);

      return {
        slug: updated.slug,
        published: updated.publishedAt != null,
      };
    },
  });
}
