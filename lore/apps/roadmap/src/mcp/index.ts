import { $module } from "alepha";
import { StreamableHttpMcpTransport } from "alepha/mcp";
import { ProjectResources } from "./resources/ProjectResources.ts";
import { ChapterTools } from "./tools/ChapterTools.ts";
import { FolioTools } from "./tools/FolioTools.ts";
import { ProjectTools } from "./tools/ProjectTools.ts";
import { TaskTools } from "./tools/TaskTools.ts";

export const RoadmapMcp = $module({
  name: "roadmap.mcp",
  services: [
    StreamableHttpMcpTransport,
    TaskTools,
    ProjectTools,
    ChapterTools,
    FolioTools,
    ProjectResources,
  ],
});
