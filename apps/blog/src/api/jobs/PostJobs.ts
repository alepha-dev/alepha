import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { posts } from "../entities/posts.ts";
import { MarkdownProvider } from "../providers/MarkdownProvider.ts";

export class PostJobs {
  protected log = $logger();
  protected posts = $repository(posts);
  protected markdown = $inject(MarkdownProvider);

  refreshContent = $job({
    handler: async () => {
      const allPosts = await this.posts.findMany({});

      this.log.info("Refreshing content", { count: allPosts.length });

      for (const post of allPosts) {
        const contentHtml = this.markdown.render(post.content);
        await this.posts.updateOne({ id: { eq: post.id } }, {
          contentHtml,
        } as any);
      }

      this.log.info("Content refresh complete");
    },
  });
}
