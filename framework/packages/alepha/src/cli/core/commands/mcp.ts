import { $inject } from "alepha";
import { $command } from "alepha/command";
import { StdioMcpTransport } from "alepha/mcp";

import { DevMcpServer } from "../mcp/DevMcpServer.ts";

export class McpCommand {
  protected readonly server = $inject(DevMcpServer);

  /**
   * Run an MCP server on stdio for a coding agent, over the Alepha apps
   * running on this machine.
   *
   * ```json
   * // .mcp.json
   * { "mcpServers": { "alepha": { "command": "npx", "args": ["alepha", "mcp"] } } }
   * ```
   *
   * The agent starts it; nobody runs it by hand. It finds the apps through
   * the inspector's run registry (`~/.alepha/run`, or `ALEPHA_RUN_DIR`), so
   * the app runs under `alepha dev` in another terminal, and it selects the
   * one whose folder contains the working directory. It never starts an app
   * and never registers the inspector itself.
   *
   * stdout carries the protocol: anything else written there goes to stderr
   * while the server runs.
   */
  public readonly mcp = $command({
    name: "mcp",
    description:
      "Run an MCP server on stdio that lets a coding agent see and drive the running app",
    handler: async ({ root }) => {
      await this.serve(root);
    },
  });

  /**
   * Serve on stdio until the client closes stdin or the process is stopped.
   */
  protected async serve(root: string): Promise<void> {
    const server = this.server.create(root).with(StdioMcpTransport);
    await server.start();
    try {
      await new Promise<void>((resolve) => {
        process.stdin.once("end", resolve);
        process.stdin.once("close", resolve);
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
      });
    } finally {
      await server.stop();
    }
  }
}
