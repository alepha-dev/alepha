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
import { $inject, Alepha } from "alepha";
import type { ToolPrimitive } from "alepha/mcp";
import type { ActionPrimitive } from "alepha/server";

import { LoreAiDocsController } from "./LoreAiDocsController.ts";

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
  protected readonly alepha = $inject(Alepha);

  /**
   * The three tables, built on first read and kept (#Q3398).
   *
   * No tool class and no controller is a field: a field would make each one
   * injected by this service, created at boot through the assistant, so none
   * could be a pure controller created on its first request. They are
   * resolved here, the first time the assistant or its access check asks.
   */
  protected built?: {
    offProject: LoreAiTool[];
    inProject: LoreAiTool[];
    writes: LoreAiTool[];
  };

  /**
   * Offered off a project page, where nothing project-scoped can be: Lore's
   * search and every list take a project.
   */
  public get offProject(): LoreAiTool[] {
    return this.tables().offProject;
  }

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
  public get inProject(): LoreAiTool[] {
    return this.tables().inProject;
  }

  /**
   * The writes a member does most from the web (#Q3210), offered like the
   * reads and each paused on a confirmation card: none declares
   * `readOnlyHint: true`, which is what makes `$ai` wait for the user. Nothing
   * that deletes, shelves, deploys or touches a host.
   *
   * `quest_update` is offered whole, every field of its schema: the card
   * shows each one the call sets. A comment needs `quest:update`, not
   * `quest:read`: that is what `createQuestComment`'s gate requires.
   */
  public get writes(): LoreAiTool[] {
    return this.tables().writes;
  }

  protected tables(): NonNullable<LoreAiToolset["built"]> {
    this.built ??= this.build();
    return this.built;
  }

  protected build(): NonNullable<LoreAiToolset["built"]> {
    const projectTools = this.alepha.inject(ProjectTools);
    const questTools = this.alepha.inject(QuestTools);
    const epicTools = this.alepha.inject(EpicTools);
    const folioTools = this.alepha.inject(FolioTools);
    const releaseTools = this.alepha.inject(ReleaseTools);
    const feedbackTools = this.alepha.inject(FeedbackTools);
    const searchController = this.alepha.inject(SearchController);
    const projectController = this.alepha.inject(ProjectController);
    const questController = this.alepha.inject(QuestController);
    const epicController = this.alepha.inject(EpicController);
    const folioController = this.alepha.inject(FolioController);
    const releaseController = this.alepha.inject(ReleaseController);
    const feedbackController = this.alepha.inject(FeedbackController);
    const commentController = this.alepha.inject(QuestCommentController);
    const docsController = this.alepha.inject(LoreAiDocsController);

    const offProject: LoreAiTool[] = [
      { tool: projectTools.project_list, permissions: [] },
    ];

    const inProject: LoreAiTool[] = [
      {
        tool: projectTools.project_info,
        permissions: ["project:read"],
        gate: projectController.getProjectById,
      },
      {
        tool: questTools.quest_list,
        permissions: ["quest:read"],
        gate: questController.getQuests,
      },
      {
        tool: questTools.quest_get,
        permissions: ["quest:read"],
        gate: questController.getQuestByShortId,
      },
      {
        // Not `epic_list`, which returns every epic with its description: 842 KB
        // on project 1 (2026-11-09, 118 epics), 26 times what `$ai` keeps of a
        // tool result, with no argument to narrow it. This index is the same
        // epics as id, number, title and status.
        tool: epicController.getEpicRefs,
        permissions: ["epic:read"],
        gate: epicController.getEpicRefs,
      },
      {
        tool: epicTools.epic_get,
        permissions: ["epic:read"],
        gate: epicController.getEpicDetailByNumber,
      },
      {
        tool: folioTools.folio_search,
        permissions: ["folio:read"],
        gate: folioController.list,
      },
      {
        tool: folioTools.folio_get,
        permissions: ["folio:read"],
        gate: folioController.getByShortId,
      },
      {
        tool: releaseTools.release_list,
        permissions: ["release:read"],
        gate: releaseController.getReleases,
      },
      {
        tool: releaseTools.release_get,
        permissions: ["release:read"],
        gate: releaseController.getReleaseContents,
      },
      {
        tool: feedbackTools.feedback_list,
        permissions: ["feedback:read"],
        gate: feedbackController.listFeedback,
      },
      {
        tool: feedbackTools.feedback_get,
        permissions: ["feedback:read"],
        gate: feedbackController.getFeedback,
      },
      {
        tool: searchController.search,
        permissions: ["quest:read", "folio:read"],
        gate: searchController.search,
      },
      {
        // Lore's own guides, for a how-to (#Q3212).
        tool: docsController.searchDocs,
        permissions: ["project:read"],
        gate: docsController.searchDocs,
      },
    ];

    const writes: LoreAiTool[] = [
      {
        tool: questTools.quest_create,
        permissions: ["quest:create"],
        gate: questController.createQuest,
      },
      {
        tool: questTools.quest_comment_add,
        permissions: ["quest:update"],
        gate: commentController.createQuestComment,
      },
      {
        tool: questTools.quest_update,
        permissions: ["quest:update"],
        gate: questController.updateQuestById,
      },
      {
        tool: questTools.quest_complete,
        permissions: ["quest:update"],
        gate: questController.completeQuest,
      },
      {
        tool: folioTools.folio_create,
        permissions: ["folio:write"],
        gate: folioController.create,
      },
    ];

    return { offProject, inProject, writes };
  }

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
