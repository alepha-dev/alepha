import { $module } from "alepha";
import { PostController } from "./controllers/PostController.ts";
import { RssController } from "./controllers/RssController.ts";
import { PostJobs } from "./jobs/PostJobs.ts";
import { AppSecurityProvider } from "./providers/AppSecurityProvider.ts";
import { MarkdownProvider } from "./providers/MarkdownProvider.ts";

export const BlogApi = $module({
  name: "blog.api",
  services: [
    AppSecurityProvider,
    MarkdownProvider,
    PostJobs,
    PostController,
    RssController,
  ],
});
