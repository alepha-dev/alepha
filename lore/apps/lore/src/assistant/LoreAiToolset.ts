import { ProjectController, SearchController } from "@lore/core/api";
import { ProjectTools } from "@lore/core/mcp";
import { FolioController } from "@lore/knowledge/api";
import { FolioTools } from "@lore/knowledge/mcp";
import {
  EpicController,
  FeedbackController,
  QuestCommentController,
  QuestController,
  ReleaseController,
} from "@lore/work/api";
import {
  EpicTools,
  FeedbackTools,
  QuestTools,
  ReleaseTools,
} from "@lore/work/mcp";
import { $inject } from "alepha";
import type { ToolPrimitive } from "alepha/mcp";
import type { ActionPrimitive } from "alepha/server";

/**
 * The assistant's tools and the permission each needs (#Q3208, #Q3209).
 *
 * The tools are Lore's own MCP tools, offered as they are (#E117): no
 * wrapper, no change to a name or a schema. Search is `SearchController`'s
 * `$action`, which `$ai` takes directly.
 *
 * ⚠️ A Lore `$tool` gates nothing itself: its handler calls a controller
 * action whose `$ownsProject({ requires })` is the gate. So what a tool needs
 * cannot be read off the tool, and this table says it, beside the list, with
 * the action that holds the gate. `assistant-tools.spec.ts` reads each gate's
 * own `requires` and refuses a table that disagrees.
 *
 * The table decides what the model is OFFERED, never what may run: a call
 * runs the tool as the turn's user, and the action's gate decides.
 *
 * Declaration order is what the vendor sees, and it stays stable so the
 * vendor caches it. Twelve read tools, under the ~25 a small model handles.
 */
export class LoreAiToolset {
  protected readonly projectTools = $inject(ProjectTools);
  protected readonly questTools = $inject(QuestTools);
  protected readonly epicTools = $inject(EpicTools);
  protected readonly folioTools = $inject(FolioTools);
  protected readonly releaseTools = $inject(ReleaseTools);
  protected readonly feedbackTools = $inject(FeedbackTools);
  protected readonly searchController = $inject(SearchController);
  protected readonly projectController = $inject(ProjectController);
  protected readonly questController = $inject(QuestController);
  protected readonly epicController = $inject(EpicController);
  protected readonly folioController = $inject(FolioController);
  protected readonly releaseController = $inject(ReleaseController);
  protected readonly feedbackController = $inject(FeedbackController);
  protected readonly commentController = $inject(QuestCommentController);

  /**
   * Offered off a project page, where nothing project-scoped can be: Lore's
   * search and every list take a project.
   */
  public readonly offProject: LoreAiTool[] = [
    { tool: this.projectTools.project_list, permissions: [] },
  ];

  /**
   * Offered inside a project, each when the user's effective permissions in
   * it hold every permission listed (and its capability is on).
   *
   * `$ai` cuts a tool result at 32 KB of text, mid-JSON, so every tool here
   * was measured on project 1, the largest real project (2026-11-09): each
   * stays under 10 KB in typical use. Hence `project_info`, not
   * `project_context` (which inlines pinned folios), and `getEpicRefs`, not
   * `epic_list`.
   */
  public readonly inProject: LoreAiTool[] = [
    {
      tool: this.projectTools.project_info,
      permissions: ["project:read"],
      gate: this.projectController.getProjectById,
    },
    {
      tool: this.questTools.quest_list,
      permissions: ["quest:read"],
      gate: this.questController.getQuests,
    },
    {
      tool: this.questTools.quest_get,
      permissions: ["quest:read"],
      gate: this.questController.getQuestByShortId,
    },
    {
      // Not `epic_list`, which returns every epic with its description: 842 KB
      // on project 1 (2026-11-09, 118 epics), 26 times what `$ai` keeps of a
      // tool result, with no argument to narrow it. This index is the same
      // epics as id, number, title and status.
      tool: this.epicController.getEpicRefs,
      permissions: ["epic:read"],
      gate: this.epicController.getEpicRefs,
    },
    {
      tool: this.epicTools.epic_get,
      permissions: ["epic:read"],
      gate: this.epicController.getEpicDetailByNumber,
    },
    {
      tool: this.folioTools.folio_search,
      permissions: ["folio:read"],
      gate: this.folioController.list,
    },
    {
      tool: this.folioTools.folio_get,
      permissions: ["folio:read"],
      gate: this.folioController.getByShortId,
    },
    {
      tool: this.releaseTools.release_list,
      permissions: ["release:read"],
      gate: this.releaseController.getReleases,
    },
    {
      tool: this.releaseTools.release_get,
      permissions: ["release:read"],
      gate: this.releaseController.getReleaseContents,
    },
    {
      tool: this.feedbackTools.feedback_list,
      permissions: ["feedback:read"],
      gate: this.feedbackController.listFeedback,
    },
    {
      tool: this.feedbackTools.feedback_get,
      permissions: ["feedback:read"],
      gate: this.feedbackController.getFeedback,
    },
    {
      tool: this.searchController.search,
      permissions: ["quest:read", "folio:read"],
      gate: this.searchController.search,
    },
  ];

  /**
   * The writes a member does most from the web (#Q3210), offered like the
   * reads and each paused on a confirmation card: none declares
   * `readOnlyHint: true`, which is what makes `$ai` wait for the user. Nothing
   * that deletes, shelves, deploys or touches an estate.
   *
   * `quest_update` is offered whole, every field of its schema: the card
   * shows each one the call sets. A comment needs `quest:update`, not
   * `quest:read`: that is what `createQuestComment`'s gate requires.
   */
  public readonly writes: LoreAiTool[] = [
    {
      tool: this.questTools.quest_create,
      permissions: ["quest:create"],
      gate: this.questController.createQuest,
    },
    {
      tool: this.questTools.quest_comment_add,
      permissions: ["quest:update"],
      gate: this.commentController.createQuestComment,
    },
    {
      tool: this.questTools.quest_update,
      permissions: ["quest:update"],
      gate: this.questController.updateQuestById,
    },
    {
      tool: this.questTools.quest_complete,
      permissions: ["quest:update"],
      gate: this.questController.completeQuest,
    },
    {
      tool: this.folioTools.folio_create,
      permissions: ["folio:write"],
      gate: this.folioController.create,
    },
  ];

  /**
   * Every project-scoped tool, reads then writes.
   */
  public get projectScoped(): LoreAiTool[] {
    return [...this.inProject, ...this.writes];
  }

  /**
   * Every tool, in declaration order: what `$ai({ tools })` takes.
   */
  public get tools(): Array<ToolPrimitive<any> | ActionPrimitive<any>> {
    return [...this.offProject, ...this.projectScoped].map(
      (entry) => entry.tool,
    );
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
  /**
   * The controller action whose `$ownsProject` gates the tool, read by the
   * spec that holds `permissions` to it. Absent for a tool gated on sign-in
   * alone (`project_list`).
   */
  gate?: ActionPrimitive<any>;
}
