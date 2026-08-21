import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";

import { MilestoneController } from "../../api/controllers/MilestoneController.ts";
import { ProjectController } from "../../api/controllers/ProjectController.ts";
import {
  milestoneChangelogParamsSchema,
  milestoneChangelogResultSchema,
  milestoneCloseParamsSchema,
  milestoneCloseResultSchema,
  milestoneListParamsSchema,
  milestoneListResultSchema,
  milestoneStartParamsSchema,
  milestoneStartResultSchema,
} from "../schemas/index.ts";

/**
 * MCP tools for milestone operations.
 */
export class MilestoneTools {
  protected readonly milestoneController = $inject(MilestoneController);
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
   * Resolve a milestone reference (`id` or `number` + project) to the global
   * milestone id.
   */
  protected async resolveMilestoneId(params: {
    id?: number;
    number?: number;
    project?: number;
    project_name?: string;
  }): Promise<number> {
    if (params.id != null) return params.id;
    if (params.number != null) {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );
      const result = await this.milestoneController.getMilestones({
        params: { projectId },
      });
      const found = result.find((ch) => ch.number === params.number);
      if (!found) {
        throw new NotFoundError(
          `Milestone ${params.number} not found in project`,
        );
      }
      return found.id;
    }
    throw new BadRequestError(
      "Milestone reference required: pass `id` (global) or `number` (per-project — also requires `project` or `project_name`).",
    );
  }

  /**
   * List all milestones for a project.
   */
  milestone_list = $tool({
    description:
      "List all milestones for a project, both active (open) and closed. Milestones are time-boxed cycles that capture completed quests. Sorted by milestone number ascending. Each entry includes id, number, title, description, questCount, createdAt, and closedAt (undefined for the active milestone).",
    title: "List milestones",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: milestoneListParamsSchema,
      result: milestoneListResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );

      const result = await this.milestoneController.getMilestones({
        params: { projectId },
      });

      return {
        milestones: result.map((ch) => ({
          id: ch.id,
          number: ch.number,
          title: ch.title,
          description: ch.description,
          questCount: ch.questCount,
          closedAt: ch.closedAt,
          createdAt: ch.createdAt,
        })),
      };
    },
  });

  /**
   * Start a new milestone.
   */
  milestone_start = $tool({
    description:
      "Start a new milestone for a project. Only one milestone can be active at a time. Quests completed while a milestone is active are automatically attached to it.",
    title: "Start milestone",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: milestoneStartParamsSchema,
      result: milestoneStartResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );

      const milestone = await this.milestoneController.startMilestone({
        params: { projectId },
        body: {
          title: params.title,
          description: params.description,
        },
      });

      return {
        id: milestone.id,
        number: milestone.number,
        title: milestone.title,
        createdAt: milestone.createdAt,
      };
    },
  });

  /**
   * Close an active milestone.
   */
  milestone_close = $tool({
    description:
      "Close an active milestone. No more quests will be attached to it after closing.",
    title: "Close milestone",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: milestoneCloseParamsSchema,
      result: milestoneCloseResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveMilestoneId(params);
      const milestone = await this.milestoneController.closeMilestone({
        params: { id },
        body: { title: params.title },
      });

      return {
        id: milestone.id,
        number: milestone.number,
        title: milestone.title,
        closedAt: milestone.closedAt!,
      };
    },
  });

  /**
   * Get changelog for a milestone.
   */
  milestone_changelog = $tool({
    description:
      "Generate a Markdown changelog for a milestone, listing all completed quests grouped by area.",
    title: "Milestone changelog",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: milestoneChangelogParamsSchema,
      result: milestoneChangelogResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveMilestoneId(params);
      const result = await this.milestoneController.getMilestoneChangelog({
        params: { id },
      });

      return {
        markdown: result.markdown,
        stats: result.stats,
      };
    },
  });
}
