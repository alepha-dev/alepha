import { ProjectTools } from "@lore/core/mcp";
import { $inject } from "alepha";
import type { ToolPrimitive } from "alepha/mcp";
import type { ActionPrimitive } from "alepha/server";

/**
 * The assistant's tools and the permission each needs (#Q3208, #Q3209).
 *
 * A Lore `$tool` gates nothing itself: its handler calls a controller action
 * whose `$ownsProject({ requires })` is the gate. So what a tool needs cannot
 * be read off the tool, and this table says it, beside the list. A spec holds
 * the two together (`assistant-tools.spec.ts`).
 *
 * Declaration order is what the vendor sees, and it stays stable so the
 * vendor caches it.
 */
export class LoreAiToolset {
  protected readonly projectTools = $inject(ProjectTools);

  /**
   * Offered off a project page, where nothing project-scoped can be: Lore's
   * search and every list take a project.
   */
  public readonly offProject: LoreAiTool[] = [
    { tool: this.projectTools.project_list, permissions: [] },
  ];

  /**
   * Offered inside a project, each when the user's effective permissions in
   * it hold every permission listed.
   */
  public readonly inProject: LoreAiTool[] = [];

  /**
   * Every tool, in declaration order: what `$ai({ tools })` takes.
   */
  public get tools(): Array<ToolPrimitive<any> | ActionPrimitive<any>> {
    return [...this.offProject, ...this.inProject].map((entry) => entry.tool);
  }

  /**
   * A tool's name as the model sees it.
   */
  public nameOf(entry: LoreAiTool): string {
    return entry.tool.name;
  }
}

/**
 * One tool of the assistant, and what the user must hold in the project to
 * be offered it.
 */
export interface LoreAiTool {
  tool: ToolPrimitive<any> | ActionPrimitive<any>;
  /**
   * The permissions the tool's own gate requires, as `group:name`.
   */
  permissions: string[];
}
