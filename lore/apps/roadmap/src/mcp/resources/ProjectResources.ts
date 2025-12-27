import { $inject } from "alepha";
import { $resource } from "alepha/mcp";
import { Db } from "../../api/providers/Db.ts";
import { McpAuth } from "../McpAuth.ts";

/**
 * MCP resources for project data.
 *
 * These resources expose read-only project information to LLM clients
 * through the MCP protocol.
 */
export class ProjectResources {
  protected readonly auth = $inject(McpAuth);
  protected readonly db = $inject(Db);

  /**
   * Project information resource.
   *
   * Returns basic project info including title, packages, and statistics.
   */
  projectInfo = $resource({
    uri: "roadmap://project/info",
    name: "Project Info",
    description:
      "Basic project information including title, packages/zones, and task statistics.",
    mimeType: "application/json",
    handler: async ({ context }) => {
      const auth = await this.auth.authenticate(context);

      const project = await this.db.projects.findById(auth.projectId);

      // Get task counts by status
      const allTasks = await this.db.tasks.findMany({
        where: { projectId: { eq: auth.projectId } },
      });

      const stats = {
        total: allTasks.length,
        new: allTasks.filter((t) => !t.acceptedAt && !t.completedAt).length,
        accepted: allTasks.filter((t) => t.acceptedAt && !t.completedAt).length,
        completed: allTasks.filter((t) => t.completedAt).length,
      };

      const data = {
        id: project.id,
        title: project.title,
        public: project.public,
        packages: project.packages,
        createdAt: project.createdAt,
        statistics: stats,
      };

      return {
        text: JSON.stringify(data, null, 2),
      };
    },
  });

  /**
   * Pending tasks resource.
   *
   * Returns a list of tasks that are not yet completed,
   * organized by status (new, accepted).
   */
  pendingTasks = $resource({
    uri: "roadmap://tasks/pending",
    name: "Pending Tasks",
    description:
      "List of pending tasks (new and accepted) with their details and objectives.",
    mimeType: "application/json",
    handler: async ({ context }) => {
      const auth = await this.auth.authenticate(context);

      const tasks = await this.db.tasks.findMany({
        where: {
          projectId: { eq: auth.projectId },
          completedAt: { isNull: true },
        },
      });

      const newTasks = tasks
        .filter((t) => !t.acceptedAt)
        .map((t) => ({
          id: t.id,
          title: t.title,
          package: t.package,
          priority: t.priority,
          complexity: t.complexity,
          objectives: t.objectives,
          createdAt: t.createdAt,
        }));

      const acceptedTasks = tasks
        .filter((t) => t.acceptedAt)
        .map((t) => ({
          id: t.id,
          title: t.title,
          package: t.package,
          priority: t.priority,
          complexity: t.complexity,
          objectives: t.objectives,
          acceptedAt: t.acceptedAt,
          acceptedBy: t.acceptedBy,
        }));

      const data = {
        new: newTasks,
        accepted: acceptedTasks,
        summary: {
          totalPending: tasks.length,
          newCount: newTasks.length,
          acceptedCount: acceptedTasks.length,
        },
      };

      return {
        text: JSON.stringify(data, null, 2),
      };
    },
  });
}
