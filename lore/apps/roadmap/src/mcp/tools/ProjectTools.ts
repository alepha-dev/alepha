import { $inject, t } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";
import { ProjectController } from "../../api/controllers/ProjectController.ts";
import {
  projectInfoParamsSchema,
  projectInfoResultSchema,
  projectListResultSchema,
} from "../schemas/index.ts";

/**
 * MCP tools for project operations.
 */
export class ProjectTools {
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
   * List all projects (campaigns) the user has access to.
   */
  project_list = $tool({
    description:
      "List all projects (campaigns) the user has access to. Use this to find available projects before querying tasks.",
    schema: {
      params: t.object({}),
      result: projectListResultSchema,
    },
    handler: async () => {
      const projects = await this.projectController.getMyProjects();

      return {
        projects: projects.map((p) => ({
          id: p.id,
          title: p.title,
          public: p.public ?? false,
          isOwner: p.createdBy !== undefined, // Owner info from project
        })),
      };
    },
  });

  /**
   * Get project information.
   */
  project_info = $tool({
    description:
      "Get information about a project, including packages/zones and active tasks.",
    schema: {
      params: projectInfoParamsSchema,
      result: projectInfoResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );

      const result = await this.projectController.getProjectById({
        params: { id: projectId },
      });

      return {
        id: result.id,
        title: result.title,
        public: result.public ?? false,
        packages: result.packages,
        createdAt: result.createdAt,
        activeTasks: result.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          package: task.package,
          priority: task.priority,
          complexity: task.complexity,
        })),
        character: result.character
          ? {
              xp: result.character.xp,
              balance: result.character.balance,
              owner: result.character.owner,
            }
          : undefined,
      };
    },
  });
}
