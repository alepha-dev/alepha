import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { $route } from "alepha/server";
import { posts } from "../entities/posts.ts";

export class RssController {
  protected log = $logger();
  protected posts = $repository(posts);

  rss = $route({
    method: "GET",
    path: "/rss.xml",
    handler: async ({ reply }) => {
      const published = await this.posts.findMany({
        where: { publishedAt: { isNotNull: true } },
        orderBy: [{ column: "publishedAt", direction: "desc" }],
        limit: 20,
      });

      const items = published
        .map(
          (post) => `    <item>
      <title><![CDATA[${post.title}]]></title>
      <link>https://blog.alepha.dev/posts/${post.slug}</link>
      <description><![CDATA[${post.summary}]]></description>
      <pubDate>${new Date(post.publishedAt!).toUTCString()}</pubDate>
      <guid>https://blog.alepha.dev/posts/${post.slug}</guid>
    </item>`,
        )
        .join("\n");

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Alepha Blog</title>
    <link>https://blog.alepha.dev</link>
    <description>Thoughts on building modern TypeScript frameworks</description>
    <language>en</language>
${items}
  </channel>
</rss>`;

      reply.setHeader("content-type", "application/rss+xml; charset=utf-8");
      reply.setHeader(
        "cache-control",
        "public, s-maxage=900, stale-while-revalidate=60",
      );

      return xml;
    },
  });
}
