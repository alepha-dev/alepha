import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";
import { ChapterController } from "../../api/controllers/ChapterController.ts";
import { ProjectController } from "../../api/controllers/ProjectController.ts";
import {
  chapterChangelogParamsSchema,
  chapterChangelogResultSchema,
  chapterCloseParamsSchema,
  chapterCloseResultSchema,
  chapterListParamsSchema,
  chapterListResultSchema,
  chapterStartParamsSchema,
  chapterStartResultSchema,
} from "../schemas/index.ts";

/**
 * MCP tools for chapter operations.
 */
export class ChapterTools {
  protected readonly chapterController = $inject(ChapterController);
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
   * List all chapters for a project.
   */
  chapter_list = $tool({
    description:
      "List all chapters for a project. Chapters are iterative milestones that capture completed quests.",
    title: "List chapters",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: chapterListParamsSchema,
      result: chapterListResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );

      const result = await this.chapterController.getChapters({
        params: { projectId },
      });

      return {
        chapters: result.map((ch) => ({
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
   * Start a new chapter.
   */
  chapter_start = $tool({
    description:
      "Start a new chapter for a project. Only one chapter can be active at a time. Quests completed while a chapter is active are automatically attached to it.",
    title: "Start chapter",
    schema: {
      params: chapterStartParamsSchema,
      result: chapterStartResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );

      const chapter = await this.chapterController.startChapter({
        params: { projectId },
        body: {
          title: params.title,
          description: params.description,
        },
      });

      return {
        id: chapter.id,
        number: chapter.number,
        title: chapter.title,
        createdAt: chapter.createdAt,
      };
    },
  });

  /**
   * Close an active chapter.
   */
  chapter_close = $tool({
    description:
      "Close an active chapter. No more quests will be attached to it after closing.",
    title: "Close chapter",
    annotations: {
      destructiveHint: true, // can't be reopened, finalizes the chapter
      idempotentHint: true,
    },
    schema: {
      params: chapterCloseParamsSchema,
      result: chapterCloseResultSchema,
    },
    handler: async ({ params }) => {
      const chapter = await this.chapterController.closeChapter({
        params: { id: params.id },
        body: { title: params.title },
      });

      return {
        id: chapter.id,
        number: chapter.number,
        title: chapter.title,
        closedAt: chapter.closedAt!,
      };
    },
  });

  /**
   * Get changelog for a chapter.
   */
  chapter_changelog = $tool({
    description:
      "Generate a Markdown changelog for a chapter, listing all completed quests grouped by zone.",
    title: "Chapter changelog",
    annotations: { readOnlyHint: true, idempotentHint: true },
    schema: {
      params: chapterChangelogParamsSchema,
      result: chapterChangelogResultSchema,
    },
    handler: async ({ params }) => {
      const result = await this.chapterController.getChapterChangelog({
        params: { id: params.id },
      });

      return {
        markdown: result.markdown,
        stats: result.stats,
      };
    },
  });
}
