import { $inject } from "alepha";
import { $resource } from "alepha/mcp";
import { ProjectController } from "../../api/controllers/ProjectController.ts";

/**
 * MCP resources for project data.
 *
 * These resources expose read-only project information to LLM clients
 * through the MCP protocol.
 *
 * Note: Use project_list tool first to get available projects,
 * then use project_info and quest_list tools for project-specific data.
 */
export class ProjectResources {
  protected readonly projectController = $inject(ProjectController);

  /**
   * List of all projects the user has access to.
   */
  projectList = $resource({
    uri: "lore://projects",
    name: "Project List",
    description:
      "List of all projects (projects) the user has access to. Use project_list tool for more details, or use project ID/title in other tools.",
    mimeType: "application/json",
    handler: async () => {
      const projects = await this.projectController.getMyProjects();

      const data = {
        projects: projects.map((p) => ({
          id: p.id,
          title: p.title,
          public: p.public ?? false,
        })),
        hint: "Use project ID or title (project_name) in tools like quest_list, project_info to access project data.",
      };

      return {
        text: JSON.stringify(data, null, 2),
      };
    },
  });
}
