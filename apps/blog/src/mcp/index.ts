import { $module } from "alepha";
import { SseMcpTransport } from "alepha/mcp";
import { PostTools } from "./tools/PostTools.ts";

export const BlogMcp = $module({
  name: "blog.mcp",
  services: [SseMcpTransport, PostTools],
});
