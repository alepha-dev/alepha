import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BlogPosts } from "../scripts/BlogPosts.ts";

const post = (fields: Record<string, string>, body = "Hello.") =>
  [
    "---",
    ...Object.entries(fields).map(([key, value]) => `${key}: ${value}`),
    "---",
    "",
    body,
    "",
  ].join("\n");

const fields = {
  title: "A title",
  description: '"Quoted: kept whole"',
  product: "bay",
};

describe("BlogPosts", () => {
  describe("parse", () => {
    it("takes the date and the slug from the file name, the rest from the front matter", () => {
      expect(
        BlogPosts.parse("2026-11-28-a-post.md", post(fields, "# Body")),
      ).toEqual({
        slug: "a-post",
        date: "2026-11-28",
        title: "A title",
        description: "Quoted: kept whole",
        product: "bay",
        path: "docs/blog/2026-11-28-a-post.md",
        markdown: "# Body",
      });
    });

    it("refuses a file name with no date, or a slug that is not lowercase words", () => {
      expect(() => BlogPosts.parse("a-post.md", post(fields))).toThrow(
        /YYYY-MM-DD-slug/,
      );
      expect(() =>
        BlogPosts.parse("2026-11-28-A_Post.md", post(fields)),
      ).toThrow(/YYYY-MM-DD-slug/);
    });

    it("refuses a post with no front matter, a missing field or an unknown product", () => {
      expect(() => BlogPosts.parse("2026-11-28-a.md", "Hello.")).toThrow(
        /front matter/,
      );
      expect(() =>
        BlogPosts.parse(
          "2026-11-28-a.md",
          post({ title: "T", product: "bay" }),
        ),
      ).toThrow(/no description/);
      expect(() =>
        BlogPosts.parse(
          "2026-11-28-a.md",
          post({ ...fields, product: "docs" }),
        ),
      ).toThrow(/not one of framework, lore, bay/);
    });
  });

  describe("read", () => {
    it("answers the posts newest first, and refuses two with one slug", async () => {
      const dir = await mkdtemp(join(tmpdir(), "blog-"));
      await writeFile(join(dir, "2026-01-02-old.md"), post(fields));
      await writeFile(join(dir, "2026-03-04-new.md"), post(fields));
      await writeFile(join(dir, "notes.txt"), "not a post");
      const posts = await BlogPosts.read(dir);
      expect(posts.map((it) => it.slug)).toEqual(["new", "old"]);

      await writeFile(join(dir, "2026-05-06-old.md"), post(fields));
      await expect(BlogPosts.read(dir)).rejects.toThrow(/share the slug "old"/);
    });

    it("answers no post when the folder does not exist", async () => {
      expect(await BlogPosts.read(join(tmpdir(), "no-such-blog-dir"))).toEqual(
        [],
      );
    });
  });

  describe("rss", () => {
    it("writes one escaped item per post, newest first, with absolute links", () => {
      const xml = BlogPosts.rss(
        [
          BlogPosts.parse(
            "2026-11-28-b.md",
            post({ ...fields, title: "Fish & <chips>" }),
          ),
          BlogPosts.parse("2026-11-01-a.md", post(fields)),
        ],
        "https://example.app",
      );
      expect(xml).toContain("<title>Fish &amp; &lt;chips&gt;</title>");
      expect(xml).toContain("<link>https://example.app/blog/b</link>");
      expect(xml).toContain("<pubDate>Sat, 28 Nov 2026 00:00:00 GMT</pubDate>");
      expect(xml.indexOf("/blog/b<")).toBeLessThan(xml.indexOf("/blog/a<"));
    });
  });
});
