import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";

import { ProjectController } from "../../api/controllers/ProjectController.ts";
import { ReleaseController } from "../../api/controllers/ReleaseController.ts";
import {
  releaseChangelogParamsSchema,
  releaseChangelogResultSchema,
  releaseCloseParamsSchema,
  releaseCloseResultSchema,
  releaseListParamsSchema,
  releaseListResultSchema,
  releaseStartParamsSchema,
  releaseStartResultSchema,
} from "../schemas/index.ts";

/**
 * MCP tools for release operations.
 */
export class ReleaseTools {
  protected readonly releaseController = $inject(ReleaseController);
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
   * Resolve a release reference (`id` or `number` + project) to the global
   * release id.
   */
  protected async resolveReleaseId(params: {
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
      const result = await this.releaseController.getReleases({
        params: { projectId },
      });
      const found = result.find((ch) => ch.number === params.number);
      if (!found) {
        throw new NotFoundError(
          `Release ${params.number} not found in project`,
        );
      }
      return found.id;
    }
    throw new BadRequestError(
      "Release reference required: pass `id` (global) or `number` (per-project — also requires `project` or `project_name`).",
    );
  }

  /**
   * List all releases for a project.
   */
  milestone_list = $tool({
    description:
      "List all releases for a project, both active (open) and closed. Releases are time-boxed cycles that capture completed quests. Sorted by release number, newest first. Each entry includes id, number, title, description, questCount, createdAt, and closedAt (undefined for the active release).",
    title: "List releases",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: releaseListParamsSchema,
      result: releaseListResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );

      const result = await this.releaseController.getReleases({
        params: { projectId },
      });

      return {
        releases: result.map((ch) => ({
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
   * Start a new release.
   */
  milestone_start = $tool({
    description:
      "Start a new release for a project. Only one release can be active at a time. Quests completed while a release is active are automatically attached to it.",
    title: "Start release",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: releaseStartParamsSchema,
      result: releaseStartResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );

      const release = await this.releaseController.startRelease({
        params: { projectId },
        body: {
          title: params.title,
          description: params.description,
        },
      });

      return {
        id: release.id,
        number: release.number,
        title: release.title,
        createdAt: release.createdAt,
      };
    },
  });

  /**
   * Close an active release.
   */
  milestone_close = $tool({
    description:
      "Close an active release. No more quests will be attached to it after closing.",
    title: "Close release",
    annotations: { readOnlyHint: false, destructiveHint: false },
    schema: {
      params: releaseCloseParamsSchema,
      result: releaseCloseResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveReleaseId(params);
      const release = await this.releaseController.closeRelease({
        params: { id },
        body: { title: params.title },
      });

      return {
        id: release.id,
        number: release.number,
        title: release.title,
        closedAt: release.closedAt!,
      };
    },
  });

  /**
   * Get changelog for a release.
   */
  milestone_changelog = $tool({
    description:
      "Generate a Markdown changelog for a release, listing all completed quests grouped by area.",
    title: "Release changelog",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: releaseChangelogParamsSchema,
      result: releaseChangelogResultSchema,
    },
    handler: async ({ params }) => {
      const id = await this.resolveReleaseId(params);
      const result = await this.releaseController.getReleaseChangelog({
        params: { id },
      });

      return {
        markdown: result.markdown,
        stats: result.stats,
      };
    },
  });
}
