import { $inject } from "alepha";
import { $tool } from "alepha/mcp";

import { EpicController } from "../../api/controllers/EpicController.ts";
import { FolioController } from "../../api/controllers/FolioController.ts";
import { ProjectController } from "../../api/controllers/ProjectController.ts";
import {
  epicCreateParamsSchema,
  epicCreateResultSchema,
  epicDeleteParamsSchema,
  epicDeleteResultSchema,
  epicGetParamsSchema,
  epicGetResultSchema,
  epicListParamsSchema,
  epicListResultSchema,
  epicSetStatusParamsSchema,
  epicSetStatusResultSchema,
  epicUpdateParamsSchema,
  epicUpdateResultSchema,
} from "../schemas/index.ts";
import { DiagramCheckService } from "../services/DiagramCheckService.ts";
import { ProjectTools } from "./ProjectTools.ts";

/**
 * MCP tools for epic operations.
 *
 * Modelled closely on `ReleaseTools`, including its `resolveProjectId`
 * helper. One difference: an epic has no id-only lookup on
 * `EpicController`, so — unlike releases (`id` / `number`) and quests
 * (`id` / `shortId`) — every epic reference here is `number` + project.
 */
export class EpicTools {
  protected readonly epicController = $inject(EpicController);
  protected readonly folioController = $inject(FolioController);
  protected readonly projectController = $inject(ProjectController);
  protected readonly diagrams = $inject(DiagramCheckService);
  protected readonly projectTools = $inject(ProjectTools);

  /**
   * Resolve project ID from params (by ID or name).
   */
  protected async resolveProjectId(
    project?: number,
    projectName?: string,
  ): Promise<number> {
    // One implementation, in `ProjectTools`. See the note there.
    return await this.projectTools.resolveProjectId(project, projectName);
  }

  /**
   * List all epics for a project.
   */
  epic_list = $tool({
    description:
      "List all epics for a project: draft, ready, in progress and completed alike (unlike quest_list's default view, nothing is hidden here). An epic is a bounded initiative that spans several areas and owns quests and folios. Sorted by epic number ascending. Each entry includes id, number, title, description, status, questCount, and the completed/total progress rollup, counted over EVERY quest in the epic, including ones a draft epic keeps out of the human-facing backlog.",
    title: "List epics",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: epicListParamsSchema,
      result: epicListResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );

      const result = await this.epicController.getEpics({
        params: { projectId },
      });

      return {
        epics: result.map((epic) => ({
          id: epic.id,
          number: epic.number,
          title: epic.title,
          description: epic.description,
          status: epic.status,
          questCount: epic.questCount,
          progress: epic.progress,
          createdAt: epic.createdAt,
          startedAt: epic.startedAt,
          completedAt: epic.completedAt,
          // The column stores an id; this surface speaks in per-project
          // numbers, the same split `quest_*` makes with `dependsOn_shortId`.
          // `buildEpicResource` is what resolves it.
          dependsOn_number: epic.dependsOnNumber,
          dependsOn_status: epic.dependsOnStatus,
        })),
      };
    },
  });

  /**
   * Get a single epic by its per-project number.
   */
  epic_get = $tool({
    description:
      "Fetch a single epic by its per-project number, including its description, status, progress rollup (completed/total quest counts; every quest in the epic counts, draft-gated ones included) and the folios filed under it (shortId, title, summary; read a body with `folio_get`). Use quest_list with the `epic` filter to fetch the quests themselves.",
    title: "Get epic",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: epicGetParamsSchema,
      result: epicGetResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );

      const epic = await this.epicController.getEpicByNumber({
        params: { projectId, number: params.number },
      });

      // Filtered server-side, same as the Epic detail page: an attached
      // folio outside a client-side window would otherwise silently drop.
      const folios = await this.folioController.list({
        query: { projectId, epicId: epic.id, limit: 100 },
      });

      return {
        id: epic.id,
        number: epic.number,
        title: epic.title,
        description: epic.description,
        status: epic.status,
        projectId: epic.projectId,
        questCount: epic.questCount,
        progress: epic.progress,
        createdAt: epic.createdAt,
        startedAt: epic.startedAt,
        completedAt: epic.completedAt,
        dependsOn_number: epic.dependsOnNumber,
        dependsOn_status: epic.dependsOnStatus,
        folios: folios.map((folio) => ({
          shortId: folio.shortId,
          title: folio.title,
          // Omit when empty so agents seeing the field always trust it.
          summary: folio.summary?.trim() ? folio.summary : undefined,
          updatedAt: folio.updatedAt,
        })),
      };
    },
  });

  /**
   * Turn a per-project epic `number` into the id `epics.dependsOn` stores.
   *
   * Three states, and they are not the same thing: `undefined` means the
   * caller did not mention the field and the column is left alone, `0` means
   * clear it, and anything else is a number to resolve. Same sentinel
   * `quest_update`'s `dependsOn_shortId` uses, and for the same reason: a
   * tool schema has no way to send a null.
   */
  protected async resolveDependsOn(
    projectId: number,
    number?: number,
  ): Promise<number | null | undefined> {
    if (number === undefined) return undefined;
    if (number === 0) return null;

    const predecessor = await this.epicController.getEpicByNumber({
      params: { projectId, number },
    });
    return predecessor.id;
  }

  /**
   * Create a new epic.
   */
  epic_create = $tool({
    description:
      "Create a new epic in the project, in the 'draft' status. The status IS the permission. While 'draft' the epic is being specified: quests are filed into it (quest_create / quest_update's `epic_number`) and stay out of the human-facing backlog, kanban, reports and quest_list's default view (quest_list's `epic:` filter or `includeDrafts: true` reads them), and none of them can be accepted. epic_set_status 'ready' says the spec is done: the quests join the backlog and can be accepted, and the plan can still be edited. The first quest accepted or assigned moves the epic to 'in_progress' by itself and freezes its quest set; the last open quest completed or shelved moves it to 'completed', which is terminal. Anything discovered once it is in progress is an objective on a quest already in the epic, or a new epic with dependsOn_number pointing at this one. Any project member may create one.",
    title: "Create epic",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: epicCreateParamsSchema,
      result: epicCreateResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );

      const epic = await this.epicController.createEpic({
        params: { projectId },
        body: {
          title: params.title,
          description: params.description,
          dependsOn: await this.resolveDependsOn(
            projectId,
            params.dependsOn_number,
          ),
        },
      });

      return {
        id: epic.id,
        number: epic.number,
        title: epic.title,
        status: epic.status,
        createdAt: epic.createdAt,
        ...this.diagrams.warn(params.description),
      };
    },
  });

  /**
   * Update an epic's title or description.
   */
  epic_update = $tool({
    description:
      "Update an epic's title, description or predecessor. Omitted fields stay unchanged. Allowed in every status, 'completed' included: the description is the account of what happened and project memory is meant to be curated. Only the quest set and the status are gated by status (see quest_create, quest_update and epic_set_status).",
    title: "Update epic",
    annotations: { readOnlyHint: false, idempotentHint: true },
    schema: {
      params: epicUpdateParamsSchema,
      result: epicUpdateResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const target = await this.epicController.getEpicByNumber({
        params: { projectId, number: params.number },
      });

      const epic = await this.epicController.updateEpic({
        params: { id: target.id },
        body: {
          title: params.title,
          description: params.description,
          dependsOn: await this.resolveDependsOn(
            projectId,
            params.dependsOn_number,
          ),
        },
      });

      return {
        id: epic.id,
        number: epic.number,
        title: epic.title,
        updatedAt: epic.updatedAt,
        ...this.diagrams.warn(params.description),
      };
    },
  });

  /**
   * Move an epic between its two hand-set statuses.
   */
  epic_set_status = $tool({
    description:
      "Mark an epic 'ready' (its spec is done) or move it back to 'draft' (still being specified). These are the only two statuses set by hand, and only between each other. 'ready' puts the epic's quests into the human-facing backlog and quest_list's default view, where they can be accepted; 'draft' takes them out again. Neither changes anything about the quests themselves. The other two statuses happen on their own: the first quest accepted or assigned moves a ready epic to 'in_progress' and freezes its quest set, and the last open quest completed or shelved moves it to 'completed', which is terminal. An epic that has started cannot go back to 'ready' or 'draft'. Asking for the status the epic already has is a no-op. " +
      "Deciding that a spec is done is the owner's call. Do not mark an epic ready just to be allowed to work on it: if a quest refuses because its epic is a draft, say so and stop.",
    title: "Set epic status",
    annotations: { readOnlyHint: false, idempotentHint: true },
    schema: {
      params: epicSetStatusParamsSchema,
      result: epicSetStatusResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const target = await this.epicController.getEpicByNumber({
        params: { projectId, number: params.number },
      });

      const epic = await this.epicController.setEpicStatus({
        params: { id: target.id },
        body: { status: params.status },
      });

      return {
        id: epic.id,
        number: epic.number,
        title: epic.title,
        status: epic.status,
      };
    },
  });

  /**
   * Delete an epic, orphaning its quests and folios.
   *
   * The description carries the child semantics in its first two sentences
   * on purpose. An agent decides whether to call a tool from the tool list
   * alone, and "delete the container" reads as "delete what is in it" unless
   * something says otherwise. An epic_delete that stayed quiet about it
   * would simply go unused, which is the same outcome as not having it.
   */
  epic_delete = $tool({
    description:
      "Permanently delete an epic. Its quests and folios are DETACHED, never deleted: every one of them survives with its epic link cleared, keeping its own status, objectives and history. Use this to remove a mis-created epic or to restructure a plan. Only the epic itself is lost, and it cannot be recovered. Note that quests parked under a `draft` epic rejoin the human-facing backlog, kanban and reports once the epic is gone, because the gate that was hiding them no longer exists. To release them deliberately use epic_set_status 'ready'; to keep them out of the backlog use quest_shelve.",
    title: "Delete epic",
    annotations: {
      destructiveHint: true,
      idempotentHint: true,
    },
    schema: {
      params: epicDeleteParamsSchema,
      result: epicDeleteResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const target = await this.epicController.getEpicByNumber({
        params: { projectId, number: params.number },
      });

      return await this.epicController.deleteEpic({
        params: { id: target.id },
      });
    },
  });
}
