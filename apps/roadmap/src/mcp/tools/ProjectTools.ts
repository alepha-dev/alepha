import { $inject, t } from "alepha";
import { $tool } from "alepha/mcp";
import { Db } from "../../api/providers/Db.ts";
import { Security } from "../../api/providers/Security.ts";
import { McpAuth } from "../McpAuth.ts";

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
   * Get project information.
   */
  project_info = $tool({
    description:
      "Get information about the current project, including packages/zones and active tasks.",
    schema: {
      params: t.object({}),
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
    handler: async ({ context }) => {
      const auth = await this.auth.authenticate(context);

      const { project } = await this.security.checkOwnership(
        auth.projectId,
        auth.user,
      );

      const character = await this.db.characters
        .findOne({
          where: {
            projectId: { eq: auth.projectId },
            userId: { eq: auth.user.id },
          },
        })
        .catch((err) => {
          if (project.public) return undefined;
          throw err;
        });

      const tasks = await this.db.tasks.findMany({
        where: {
          projectId: { eq: auth.projectId },
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
