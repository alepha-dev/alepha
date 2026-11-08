import { Alepha, type ServiceEntry } from "alepha";
import { AlephaMcp, McpServerProvider } from "alepha/mcp";

import { version } from "../alephaPackageJson.ts";
import { DevMcpAppTools } from "./DevMcpAppTools.ts";
import { DevMcpLogTools } from "./DevMcpLogTools.ts";
import { DevMcpMapTools } from "./DevMcpMapTools.ts";
import { DevMcpSession } from "./DevMcpSession.ts";

/**
 * Builds the container `alepha mcp` serves: the MCP module, the session and
 * every tool, without a transport. The command adds stdio; a spec calls the
 * tools directly.
 *
 * A container of its own because the CLI's is started, and so locked,
 * before any command runs: the MCP module cannot join it then, and
 * registering it up front would load it for every command.
 */
export class DevMcpServer {
  /**
   * What the agent reads first: what the tools are for, and in which order.
   * Kept short, a client may put it in every conversation.
   */
  public readonly instructions = [
    "Tools to see and drive the Alepha app running on this machine under `alepha dev`.",
    "Start with apps_list: the app whose folder contains this project is selected on its own, else call app_select.",
    "Then read what the app registers before acting on it, and read its logs to see what a call did.",
    "When no app runs, the tools say so: start one with `alepha dev`.",
  ].join(" ");

  /**
   * The tool classes, in the order `tools/list` shows them.
   */
  protected readonly tools: ServiceEntry[] = [
    DevMcpAppTools,
    DevMcpMapTools,
    DevMcpLogTools,
  ];

  /**
   * A new, unstarted server container whose tools act on the apps found
   * from `root`. `substitutions` are applied first, since the container
   * injects its services here, before it starts.
   */
  public create(
    root: string,
    env: Record<string, string> = {},
    substitutions: ServiceEntry[] = [],
  ): Alepha {
    // stdout carries the protocol. The stdio transport redirects stray
    // writes while it runs, but the server's own log lines go to stderr from
    // the start, as the MCP spec asks.
    const server = Alepha.create({ env, "alepha.logger.stream": "stderr" });
    for (const entry of substitutions) {
      server.with(entry);
    }
    server.with(AlephaMcp).with(DevMcpSession);
    for (const tools of this.tools) {
      server.with(tools);
    }

    server.inject(DevMcpSession).root = root;
    const mcp = server.inject(McpServerProvider);
    mcp.serverInfo = {
      name: "alepha",
      version,
      description: "The Alepha app running on this machine, for a coding agent",
    };
    mcp.instructions = this.instructions;
    return server;
  }
}
