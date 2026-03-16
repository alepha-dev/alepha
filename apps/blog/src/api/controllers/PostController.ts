import { $inject, t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";
import { $etag } from "alepha/server/etag";
import { posts } from "../entities/posts.ts";
import { MarkdownProvider } from "../providers/MarkdownProvider.ts";
import { postCreateSchema } from "../schemas/postCreateSchema.ts";
import { postUpdateSchema } from "../schemas/postUpdateSchema.ts";

export class PostController {
  protected log = $logger();
  protected posts = $repository(posts);
  protected markdown = $inject(MarkdownProvider);
  protected dateTime = $inject(DateTimeProvider);

  listPublished = $action({
    method: "GET",
    path: "/posts",
    use: [
      $etag({
        control: { public: true, sMaxAge: 900, staleWhileRevalidate: 60 },
      }),
    ],
    schema: {
      query: t.object({
        tag: t.optional(t.shortText()),
      }),
    },
    handler: async ({ query }) => {
      const where: Record<string, any> = {
        publishedAt: { isNotNull: true },
      };

      if (query?.tag) {
        where.tags = { arrayContains: query.tag };
      }

      return (await this.posts.findMany({
        where,
        orderBy: [{ column: "publishedAt", direction: "desc" }],
      })) as any;
    },
  });

  getBySlug = $action({
    method: "GET",
    path: "/posts/:slug",
    use: [
      $etag({
        control: { public: true, sMaxAge: 900, staleWhileRevalidate: 60 },
      }),
    ],
    schema: {
      params: t.object({ slug: t.shortText() }),
    },
    handler: async ({ params }) => {
      return (await this.posts.getOne({
        where: {
          slug: { eq: params.slug },
          publishedAt: { isNotNull: true },
        },
      })) as any;
    },
  });

  createPost = $action({
    use: [$secure()],
    schema: {
      body: postCreateSchema,
    },
    handler: async ({ body, user }) => {
      const contentHtml = this.markdown.render(body.content);

      return (await this.posts.create({
        ...body,
        contentHtml,
        tags: body.tags ?? [],
        authorId: user.id,
      })) as any;
    },
  });

  updatePost = $action({
    method: "PUT",
    use: [$secure()],
    schema: {
      params: t.object({ slug: t.shortText() }),
      body: postUpdateSchema,
    },
    handler: async ({ params, body }) => {
      const post = await this.posts.getOne({
        where: { slug: { eq: params.slug } },
      });

      const update: Record<string, any> = { ...body };

      if (body.content !== undefined) {
        update.contentHtml = this.markdown.render(body.content);
      }

      return (await this.posts.updateOne(
        { id: { eq: post.id } },
        update as any,
      )) as any;
    },
  });

  publishPost = $action({
    method: "POST",
    use: [$secure()],
    schema: {
      params: t.object({ slug: t.shortText() }),
    },
    handler: async ({ params }) => {
      const post = await this.posts.getOne({
        where: { slug: { eq: params.slug } },
      });

      return (await this.posts.updateOne({ id: { eq: post.id } }, {
        publishedAt: this.dateTime.toISOString(),
      } as any)) as any;
    },
  });

  unpublishPost = $action({
    method: "POST",
    use: [$secure()],
    schema: {
      params: t.object({ slug: t.shortText() }),
    },
    handler: async ({ params }) => {
      const post = await this.posts.getOne({
        where: { slug: { eq: params.slug } },
      });

      return (await this.posts.updateOne({ id: { eq: post.id } }, {
        publishedAt: null,
      } as any)) as any;
    },
  });

  deletePost = $action({
    method: "DELETE",
    use: [$secure()],
    schema: {
      params: t.object({ slug: t.shortText() }),
    },
    handler: async ({ params }) => {
      const post = await this.posts.getOne({
        where: { slug: { eq: params.slug } },
      });

      await this.posts.deleteById(post.id);
      return { ok: true } as any;
    },
  });

  listAll = $action({
    use: [$secure()],
    handler: async () => {
      return (await this.posts.findMany({
        orderBy: [{ column: "createdAt", direction: "desc" }],
      })) as any;
    },
  });
}
