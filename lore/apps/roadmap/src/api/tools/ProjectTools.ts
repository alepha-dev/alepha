import { $inject, t } from "alepha";
import { $tool } from "alepha/mcp";
import { $repository } from "alepha/orm";
import { characters } from "../entities/characters.ts";
import { projects } from "../entities/projects.ts";
import { tasks } from "../entities/tasks.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import { McpAuthProvider } from "../providers/McpAuthProvider.ts";

/**
 * Common project parameters for MCP tools.
 */
const projectParams = {
  project: t.optional(
    t.integer({
      description: "Project ID. Required if project_name is not provided.",
    }),
  ),
  project_name: t.optional(
    t.string({
      description:
        "Project name (campaign title). Case-insensitive. Required if project is not provided.",
    }),
  ),
};

/**
 * MCP tools for project operations.
 *
 * These tools expose project information to LLM clients
 * through the MCP protocol.
 */
export class ProjectTools {
  protected readonly auth = $inject(McpAuthProvider);
  protected readonly projects = $repository(projects);
  protected readonly characters = $repository(characters);
  protected readonly tasks = $repository(tasks);
  protected readonly security = $inject(AppSecurityProvider);

  /**
   * List all projects (campaigns) the user has access to.
   */
  project_list = $tool({
    description:
      "List all projects (campaigns) the user has access to. Use this to find available projects before querying tasks.",
    schema: {
      params: t.object({}),
      result: t.object({
        projects: t.array(
          t.object({
            id: t.integer(),
            title: t.string(),
            public: t.boolean(),
            isOwner: t.boolean(),
          }),
        ),
      }),
    },
    handler: async ({ context }) => {
      const authContext = await this.auth.authenticate(context);

      // Get all projects user has access to
      const userProjects = await this.auth.getUserProjects(authContext);

      // Get ownership info
      const ownedProjects = await this.projects.findMany({
        where: { createdBy: { eq: authContext.user.id } },
      });
      const ownedIds = new Set(ownedProjects.map((p) => p.id));

      return {
        projects: userProjects.map((p) => ({
          id: p.id,
          title: p.title,
          public: p.public,
          isOwner: ownedIds.has(p.id),
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
      params: t.object({
        ...projectParams,
      }),
      result: t.object({
        id: t.integer(),
        title: t.string(),
        public: t.boolean(),
        packages: t.array(t.string()),
        createdAt: t.datetime(),
        activeTasks: t.array(
          t.object({
            id: t.integer(),
            title: t.string(),
            package: t.string(),
            priority: t.enum(["optional", "low", "medium", "high"]),
            complexity: t.integer(),
          }),
        ),
        character: t.optional(
          t.object({
            xp: t.integer(),
            balance: t.integer(),
            owner: t.boolean(),
          }),
        ),
      }),
    },
    handler: async ({ params, context }) => {
      const authContext = await this.auth.authenticate(context);
      const projectId = await this.auth.resolveProject(
        authContext,
        params.project,
        params.project_name,
      );

      const { project } = await this.security.checkOwnership(
        projectId,
        authContext.user,
      );

      const character = await this.characters
        .findOne({
          where: {
            projectId: { eq: projectId },
            userId: { eq: authContext.user.id },
          },
        })
        .catch((err) => {
          if (project.public) return undefined;
          throw err;
        });

      const projectTasks = await this.tasks.findMany({
        where: {
          projectId: { eq: projectId },
          completedAt: { isNull: true },
          acceptedBy: { eq: authContext.user.id },
        },
      });

      return {
        id: project.id,
        title: project.title,
        public: project.public ?? false,
        packages: project.packages,
        createdAt: project.createdAt,
        activeTasks: projectTasks.map((task) => ({
          id: task.id,
          title: task.title,
          package: task.package,
          priority: task.priority,
          complexity: task.complexity,
        })),
        character: character
          ? {
              xp: character.xp,
              balance: character.balance,
              owner: character.owner,
            }
          : undefined,
      };
    },
  });
}
