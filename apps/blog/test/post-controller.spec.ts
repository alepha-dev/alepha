import { $inject, Alepha } from "alepha";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaServer } from "alepha/server";
import { AlephaServerEtag } from "alepha/server/etag";
import { afterEach, beforeEach, describe, it } from "vitest";
import { PostController } from "../src/api/controllers/PostController.ts";
import { posts } from "../src/api/entities/posts.ts";
import { users } from "../src/api/entities/users.ts";
import { MarkdownProvider } from "../src/api/providers/MarkdownProvider.ts";

class SeedHelper {
  posts = $repository(posts);
  users = $repository(users);
  markdown = $inject(MarkdownProvider);
}

describe("PostController", () => {
  let alepha: Alepha;
  let controller: PostController;
  let seed: SeedHelper;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        DATABASE_URL: ":memory:",
        SERVER_PORT: 0,
      },
    });

    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaServerEtag);

    controller = alepha.inject(PostController);
    seed = alepha.inject(SeedHelper);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha?.stop();
  });

  const seedUser = async () => {
    const user = await seed.users.create({
      id: crypto.randomUUID(),
      realm: "default",
      roles: [],
      enabled: true,
      emailVerified: false,
    });
    return user;
  };

  const seedPost = async (
    data: Partial<{
      slug: string;
      title: string;
      summary: string;
      content: string;
      contentHtml: string;
      tags: string[];
      publishedAt: string | undefined;
      authorId: string;
    }>,
  ) => {
    let authorId = data.authorId;
    if (!authorId) {
      const user = await seedUser();
      authorId = user.id;
    }

    const content = data.content ?? "test";
    return await seed.posts.create({
      slug: data.slug ?? "test-slug",
      title: data.title ?? "Test",
      summary: data.summary ?? "test",
      content,
      contentHtml: data.contentHtml ?? seed.markdown.render(content),
      tags: data.tags ?? [],
      publishedAt: data.publishedAt ?? undefined,
      authorId,
      ...data,
    });
  };

  describe("listPublished", () => {
    it("should only return published posts", async ({ expect }) => {
      await seedPost({ slug: "draft", publishedAt: undefined });
      await seedPost({
        slug: "published",
        publishedAt: new Date().toISOString(),
      });

      const result = await controller.listPublished.run({});
      expect(result.length).toBe(1);
      expect(result[0].slug).toBe("published");
    });

    it.skip("should filter by tag (arrayContains not supported on SQLite)", async ({
      expect,
    }) => {
      await seedPost({
        slug: "tagged",
        tags: ["ts"],
        publishedAt: new Date().toISOString(),
      });
      await seedPost({
        slug: "untagged",
        tags: ["go"],
        publishedAt: new Date().toISOString(),
      });

      const result = await controller.listPublished.run({
        query: { tag: "ts" },
      });
      expect(result.length).toBe(1);
      expect(result[0].slug).toBe("tagged");
    });
  });

  describe("getBySlug", () => {
    it("should return a published post by slug", async ({ expect }) => {
      await seedPost({
        slug: "my-post",
        title: "My Post",
        publishedAt: new Date().toISOString(),
      });

      const result = await controller.getBySlug.run({
        params: { slug: "my-post" },
      });
      expect(result.title).toBe("My Post");
    });

    it("should not return draft posts", async ({ expect }) => {
      await seedPost({ slug: "draft-post", publishedAt: undefined });

      await expect(
        controller.getBySlug.run({ params: { slug: "draft-post" } }),
      ).rejects.toThrow();
    });
  });

  describe("MarkdownProvider integration", () => {
    it("should render markdown in contentHtml", async ({ expect }) => {
      await seedPost({
        slug: "md-test",
        content: "# Hello\n\n**bold**",
        publishedAt: new Date().toISOString(),
      });

      const result = await controller.getBySlug.run({
        params: { slug: "md-test" },
      });
      expect(result.contentHtml).toContain("<h1>Hello</h1>");
      expect(result.contentHtml).toContain("<strong>bold</strong>");
    });
  });
});
