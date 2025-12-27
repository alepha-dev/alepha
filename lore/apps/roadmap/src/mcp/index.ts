import { $module } from "alepha";
import { AlephaMcp, SseMcpTransport } from "alepha/mcp";
import { McpAuth } from "./McpAuth.ts";
import { ProjectResources } from "./resources/ProjectResources.ts";
import { ProjectTools } from "./tools/ProjectTools.ts";
import { TaskTools } from "./tools/TaskTools.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./McpAuth.ts";
export * from "./resources/ProjectResources.ts";
export * from "./tools/ProjectTools.ts";
export * from "./tools/TaskTools.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Roadmap MCP module.
 *
 * Exposes roadmap functionality through the Model Context Protocol,
 * allowing LLM clients to interact with tasks and projects.
 *
 * **Features**
 * - Bearer token authentication via API keys
 * - Task management tools (list, create, accept, complete, update)
 * - Project information tools and resources
 *
 * **Usage**
 * Configure your MCP client with:
 * - Server URL: `{base}/mcp`
 * - Authorization header: `Bearer {api-key}`
 */
export const RoadmapMcp = $module({
  name: "roadmap.mcp",
  services: [
    AlephaMcp,
    SseMcpTransport,
    McpAuth,
    TaskTools,
    ProjectTools,
    ProjectResources,
  ],
});
