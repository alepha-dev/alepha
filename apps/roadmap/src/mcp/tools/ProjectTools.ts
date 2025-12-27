import { $inject, t } from "alepha";
import { $tool } from "alepha/mcp";
import { Db } from "../../api/providers/Db.ts";
import { Security } from "../../api/providers/Security.ts";
import { McpAuth } from "../McpAuth.ts";

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
  protected readonly auth = $inject(McpAuth);
  protected readonly db = $inject(Db);
  protected readonly security = $inject(Security);

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
      const auth = await this.auth.authenticate(context);

      // Get all projects user has access to
      const userProjects = await this.auth.getUserProjects(auth);

      // Get ownership info
      const ownedProjects = await this.db.projects.findMany({
        where: { createdBy: { eq: auth.user.id } },
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
      const auth = await this.auth.authenticate(context);
      const projectId = await this.auth.resolveProject(
        auth,
        params.project,
        params.project_name,
      );

      const { project } = await this.security.checkOwnership(
        projectId,
        auth.user,
      );

      const character = await this.db.characters
        .findOne({
          where: {
            projectId: { eq: projectId },
            userId: { eq: auth.user.id },
          },
        })
        .catch((err) => {
          if (project.public) return undefined;
          throw err;
        });

      const tasks = await this.db.tasks.findMany({
        where: {
          projectId: { eq: projectId },
          completedAt: { isNull: true },
          acceptedBy: { eq: auth.user.id },
        },
      });

      return {
        id: project.id,
        title: project.title,
        public: project.public ?? false,
        packages: project.packages,
        createdAt: project.createdAt,
        activeTasks: tasks.map((task) => ({
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
