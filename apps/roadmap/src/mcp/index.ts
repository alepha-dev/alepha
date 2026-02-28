import { $module } from "alepha";
import { SseMcpTransport } from "alepha/mcp";
import { ProjectResources } from "./resources/ProjectResources.ts";
import { ChapterTools } from "./tools/ChapterTools.ts";
import { ProjectTools } from "./tools/ProjectTools.ts";
import { TaskTools } from "./tools/TaskTools.ts";

export const RoadmapMcp = $module({
  name: "roadmap.mcp",
  services: [
    SseMcpTransport,
    TaskTools,
    ProjectTools,
    ChapterTools,
    ProjectResources,
  ],
});
