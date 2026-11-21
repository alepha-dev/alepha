import { $hook, $inject, Alepha } from "alepha";
import { ForbiddenError } from "alepha/server";

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

  /**
   * The project this run is pinned to, or undefined when it is not pinned.
   */
  pinnedProject(): number | undefined {
    return this.alepha.context.get<McpProjectHolder>(McpProjectScope.KEY)
      ?.pinned;
  }

  resolved(projectId: number): void {
    const holder = this.alepha.context.get<McpProjectHolder>(
      McpProjectScope.KEY,
    );
    if (holder) {
      // A pinned run reads one project, whatever the model asked for
      // (#Q3930): a tool resolving any other is refused before it runs.
      if (holder.pinned !== undefined && holder.pinned !== projectId) {
        throw new ForbiddenError(
          `This run belongs to project ${holder.pinned}: it cannot reach project ${projectId}`,
        );
      }
      holder.project = projectId;
    }
  }

  /**
   * Run `work` held to one project (#E161, #Q3930): every tool gate that
   * resolves a project (`$ownsProject`, `ProjectTools`) refuses any other.
   *
   * What an agent answering in a chat room runs under: other members' text
   * is model input there, so the room's project is enforced in code rather
   * than asked for in the prompt. `work` must do all its awaiting inside:
   * the pin is the async context it runs in.
   */
  public pinned<R>(projectId: number, work: () => R): R {
    return this.alepha.context.run(work, {
      [McpProjectScope.KEY]: { pinned: projectId } satisfies McpProjectHolder,
    });
  }

  /**
   * Pins the current MCP request to one project (#Q3995): what a job key's
   * call runs under, set by `JobKeyService` before the tool runs. Throws
   * when the request is already pinned to another one.
   */
  public pin(projectId: number): void {
    const holder = this.alepha.context.get<McpProjectHolder>(
      McpProjectScope.KEY,
    );
    if (!holder) {
      throw new ForbiddenError("A job key reaches Lore's MCP only");
    }
    if (holder.pinned !== undefined && holder.pinned !== projectId) {
      throw new ForbiddenError(
        `This run belongs to project ${holder.pinned}: it cannot reach project ${projectId}`,
      );
    }
    holder.pinned = projectId;
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
  /**
   * The only project a pinned run may resolve.
   */
  pinned?: number;
}
