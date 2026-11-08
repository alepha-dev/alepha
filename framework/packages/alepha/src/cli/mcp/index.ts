import { $module } from "alepha";

import { McpCommand } from "./commands/mcp.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./commands/mcp.ts";
export * from "./services/DevMcpActionTools.ts";
export * from "./services/DevMcpAppTools.ts";
export * from "./services/DevMcpDataTools.ts";
export * from "./services/DevMcpDocsTools.ts";
export * from "./services/DevMcpLogTools.ts";
export * from "./services/DevMcpMapTools.ts";
export * from "./services/DevMcpServer.ts";
export * from "./services/DevMcpSession.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * `alepha mcp`: an MCP server on stdio for the coding agent working on an
 * app. It finds the apps `alepha dev` runs through the inspector's run
 * registry, and exposes their map, logs, captured emails and SMS, database
 * rows, jobs and actions as tools, along with the installed docs.
 *
 * A module of its own, registered by the `alepha` binary only, rather than a
 * command of `alepha/cli`: it reaches the inspector, and through it the ORM,
 * which a tool that bundles the `alepha/cli` services must not carry.
 *
 * @module alepha.cli.mcp
 */
export const AlephaCliMcp = $module({
  name: "alepha.cli.mcp",
  services: [McpCommand],
});
