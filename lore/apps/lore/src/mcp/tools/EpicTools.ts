import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";

import { EpicController } from "../../api/controllers/EpicController.ts";
import { FolioController } from "../../api/controllers/FolioController.ts";
import { ProjectController } from "../../api/controllers/ProjectController.ts";
import {
  epicCreateParamsSchema,
  epicCreateResultSchema,
  epicGetParamsSchema,
  epicGetResultSchema,
  epicListParamsSchema,
  epicListResultSchema,
  epicSetStatusParamsSchema,
  epicSetStatusResultSchema,
  epicUpdateParamsSchema,
  epicUpdateResultSchema,
} from "../schemas/index.ts";

/**
 * MCP tools for epic operations.
 *
 * Modelled closely on `MilestoneTools`, including its `resolveProjectId`
 * helper. One difference: an epic has no id-only lookup on
 * `EpicController`, so — unlike milestones (`id` / `number`) and quests
 * (`id` / `shortId`) — every epic reference here is `number` + project.
 */
export class EpicTools {
  protected readonly epicController = $inject(EpicController);
  protected readonly folioController = $inject(FolioController);
  protected readonly projectController = $inject(ProjectController);

  /**
   * Resolve project ID from params (by ID or name).
   */
  protected async resolveProjectId(
    project?: number,
    projectName?: string,
  ): Promise<number> {
    const projects = await this.projectController.getMyProjects();

    if (project) {
      const found = projects.find((p) => p.id === project);
      if (!found) {
        throw new NotFoundError(`Project with ID ${project} not found`);
      }
      return found.id;
    }

    if (projectName) {
      const found = projects.find(
        (p) => p.title.toLowerCase() === projectName.toLowerCase(),
      );
      if (!found) {
        throw new NotFoundError(`Project "${projectName}" not found`);
      }
      return found.id;
    }

    throw new BadRequestError(
      "Project is required. Specify project ID or project_name.",
    );
  }

  /**
   * List all epics for a project.
   */
  epic_list = $tool({
    description:
      "List all epics for a project: planned, active and done alike (unlike quest_list's default view, nothing is hidden here). An epic is a bounded initiative that spans several areas and owns quests and folios. Sorted by epic number ascending. Each entry includes id, number, title, description, status, questCount, and the completed/total progress rollup, counted over EVERY quest in the epic, including ones a planned epic keeps out of the human-facing backlog.",
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
          activatedAt: epic.activatedAt,
          completedAt: epic.completedAt,
        })),
      };
    },
  });

  /**
   * Get a single epic by its per-project number.
   */
  epic_get = $tool({
    description:
      "Fetch a single epic by its per-project number, including its description, status, progress rollup (completed/total quest counts; every quest in the epic counts, planned-gated ones included) and the folios filed under it (shortId, title, summary; read a body with `folio_get`). Use quest_list with the `epic` filter to fetch the quests themselves.",
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
        activatedAt: epic.activatedAt,
        completedAt: epic.completedAt,
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
   * Create a new epic.
   */
  epic_create = $tool({
    description:
      "Create a new epic in the project, in the 'planned' status. Quests filed under a planned epic (quest_create / quest_update's `epic_number`) stay out of the human-facing backlog, kanban and reports until the epic is activated (epic_set_status); quest_list keeps returning them regardless, since MCP is deliberately not gated. Any project member may create one.",
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
        },
      });

      return {
        id: epic.id,
        number: epic.number,
        title: epic.title,
        status: epic.status,
        createdAt: epic.createdAt,
      };
    },
  });

  /**
   * Update an epic's title or description.
   */
  epic_update = $tool({
    description:
      "Update an epic's title or description. Omitted fields stay unchanged.",
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
        },
      });

      return {
        id: epic.id,
        number: epic.number,
        title: epic.title,
        updatedAt: epic.updatedAt,
      };
    },
  });

  /**
   * Change an epic's status.
   */
  epic_set_status = $tool({
    description:
      "Change an epic's status: planned, active, or done. All transitions are legal; there is no forbidden edge. Moving to 'active' for the first time stamps activatedAt (kept across later swings; it marks when the epic began, not when it was last active); moving to 'done' stamps completedAt; moving away from 'done' clears it. Never writes to any quest row. This only changes what the backlog gate matches.",
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
        activatedAt: epic.activatedAt,
        completedAt: epic.completedAt,
      };
    },
  });
}
