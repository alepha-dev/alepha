import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { AlephaError } from "alepha";

import { DocsRoots } from "./roots.ts";

/**
 * Which product a post is about: the filter on `/blog` reads it.
 */
export type BlogProduct = "framework" | "lore" | "bay";

/**
 * One post of `docs/blog/`, read at gen time.
 */
export interface BlogPost {
  /**
   * The URL's last segment: the file name without its date. Frozen once
   * published, since every link to the post carries it.
   */
  slug: string;
  /**
   * `YYYY-MM-DD`, from the file name.
   */
  date: string;
  title: string;
  description: string;
  product: BlogProduct;
  /**
   * The file, relative to the repository root.
   */
  path: string;
  /**
   * The body, front matter taken out.
   */
  markdown: string;
}

/**
 * The blog's posts: Markdown files in `docs/blog/`, named
 * `YYYY-MM-DD-slug.md`, each opening on a front matter that gives its
 * `title`, `description` and `product`.
 *
 * They are read from the working tree, never from a release pin: a post
 * ships when it lands on `main`, with no release.
 */
export class BlogPosts {
  /**
   * Where the posts live.
   */
  public static readonly dir = join(DocsRoots.repo, "docs", "blog");

  public static readonly PRODUCTS: BlogProduct[] = ["framework", "lore", "bay"];

  protected static readonly FILE =
    /^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

  /**
   * Every post, newest first. A file that is not a well-formed post fails
   * the build, naming the file and what is wrong.
   */
  public static async read(dir = BlogPosts.dir): Promise<BlogPost[]> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const posts: BlogPost[] = [];
    for (const name of names.filter((it) => it.endsWith(".md")).sort()) {
      const source = await readFile(join(dir, name), "utf-8");
      posts.push(BlogPosts.parse(name, source));
    }
    const seen = new Set<string>();
    for (const post of posts) {
      if (seen.has(post.slug)) {
        throw new AlephaError(
          `Two blog posts share the slug "${post.slug}": a slug carries no date, so it must be unique`,
        );
      }
      seen.add(post.slug);
    }
    return posts.sort((a, b) =>
      a.date === b.date
        ? a.slug.localeCompare(b.slug)
        : a.date < b.date
          ? 1
          : -1,
    );
  }

  /**
   * One post from its file name and its source.
   */
  public static parse(filename: string, source: string): BlogPost {
    const file = BlogPosts.FILE.exec(filename);
    if (!file) {
      throw new AlephaError(
        `Blog post ${filename}: the file must be named YYYY-MM-DD-slug.md, the slug in lowercase words joined by dashes`,
      );
    }
    const [, date, slug] = file;
    if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      throw new AlephaError(`Blog post ${filename}: ${date} is not a date`);
    }
    const text = source.replace(/\r\n/g, "\n");
    const front = /^---\n([\s\S]*?)\n---\n?/.exec(text);
    if (!front) {
      throw new AlephaError(
        `Blog post ${filename}: it must open on a front matter between two --- lines`,
      );
    }
    const fields: Record<string, string> = {};
    for (const line of front[1].split("\n")) {
      if (!line.trim()) {
        continue;
      }
      const field = /^([a-z]+):\s*(.*)$/.exec(line);
      if (!field) {
        throw new AlephaError(
          `Blog post ${filename}: "${line}" is not a "key: value" line`,
        );
      }
      fields[field[1]] = BlogPosts.unquote(field[2].trim());
    }
    for (const key of ["title", "description", "product"]) {
      if (!fields[key]) {
        throw new AlephaError(`Blog post ${filename}: no ${key}`);
      }
    }
    const product = fields.product as BlogProduct;
    if (!BlogPosts.PRODUCTS.includes(product)) {
      throw new AlephaError(
        `Blog post ${filename}: product "${fields.product}" is not one of ${BlogPosts.PRODUCTS.join(", ")}`,
      );
    }
    return {
      slug,
      date,
      title: fields.title,
      description: fields.description,
      product,
      path: `docs/blog/${filename}`,
      markdown: text.slice(front[0].length).trim(),
    };
  }

  /**
   * A post as its `.md` alternate serves it: its title as the heading, its
   * description, then the body.
   */
  public static markdown(post: BlogPost, site: string): string {
    return [
      `# ${post.title}`,
      "",
      `> ${post.description}`,
      "",
      `Published ${post.date}, about ${BlogPosts.label(post.product)}. ${site}/blog/${post.slug}`,
      "",
      post.markdown,
      "",
    ].join("\n");
  }

  /**
   * `/blog/rss.xml`: every post, newest first, as RSS 2.0.
   */
  public static rss(posts: BlogPost[], site: string): string {
    const items = posts.map((post) => {
      const url = `${site}/blog/${post.slug}`;
      return [
        "    <item>",
        `      <title>${BlogPosts.xml(post.title)}</title>`,
        `      <link>${BlogPosts.xml(url)}</link>`,
        `      <guid isPermaLink="true">${BlogPosts.xml(url)}</guid>`,
        `      <pubDate>${new Date(`${post.date}T00:00:00Z`).toUTCString()}</pubDate>`,
        `      <category>${BlogPosts.label(post.product)}</category>`,
        `      <description>${BlogPosts.xml(post.description)}</description>`,
        "    </item>",
      ].join("\n");
    });
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
      "  <channel>",
      "    <title>Alepha blog</title>",
      `    <link>${BlogPosts.xml(`${site}/blog`)}</link>`,
      `    <atom:link href="${BlogPosts.xml(`${site}/blog/rss.xml`)}" rel="self" type="application/rss+xml"/>`,
      "    <description>The stories behind the changelog of the framework, Lore and Bay.</description>",
      "    <language>en</language>",
      ...(posts[0]
        ? [
            `    <lastBuildDate>${new Date(`${posts[0].date}T00:00:00Z`).toUTCString()}</lastBuildDate>`,
          ]
        : []),
      ...items,
      "  </channel>",
      "</rss>",
      "",
    ].join("\n");
  }

  /**
   * The product's name as a reader sees it.
   */
  public static label(product: BlogProduct): string {
    return product === "framework"
      ? "the framework"
      : product === "lore"
        ? "Lore"
        : "Bay";
  }

  protected static unquote(value: string): string {
    const quoted = /^(["'])(.*)\1$/.exec(value);
    return quoted ? quoted[2] : value;
  }

  protected static xml(text: string): string {
    return text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
}
