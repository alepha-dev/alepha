import { $hook, $inject, Alepha } from "alepha";

/**
 * The project an MCP tool call actually resolved (#Q3012), for `mcp_calls`.
 *
 * A tool names its project under a different argument per tool, and sometimes
 * not at all, so the arguments could only be guessed from. What cannot be
 * guessed is the project a permission check passed on: `$ownsProject` and
 * `ProjectTools.resolveProjectId` report it here.
 *
 * A holder seeded on the request layer and mutated by reference, for the
 * reason `McpCallTimings` gives: `$action.run()` forks a layer per action, so a
 * value set inside one would be invisible to the `mcp:tool:call:end` hook.
 * Seeded on the MCP path only, so every other request pays nothing.
 *
 * A call that reached two projects keeps the last. One that resolved none, or
 * was refused before a check passed, is `none`.
 */
export class McpProjectScope {
  protected readonly alepha = $inject(Alepha);

  static readonly KEY = "lore.mcp.project";

  protected readonly onRequest = $hook({
    on: "server:request:before",
    priority: "first",
    handler: ({ request }) => {
      if (request.url.pathname.startsWith("/mcp")) {
        this.alepha.context.set<McpProjectHolder>(McpProjectScope.KEY, {});
      }
    },
  });

  resolved(projectId: number): void {
    const holder = this.alepha.context.get<McpProjectHolder>(
      McpProjectScope.KEY,
    );
    if (holder) {
      holder.project = projectId;
    }
  }

  current(): string {
    const holder = this.alepha.context.get<McpProjectHolder>(
      McpProjectScope.KEY,
    );
    return holder?.project === undefined ? "none" : String(holder.project);
  }
}

interface McpProjectHolder {
  project?: number;
}
