import { $inject } from "alepha";
import { $tool } from "alepha/mcp";
import { BadRequestError, NotFoundError } from "alepha/server";
import { ProjectController } from "../../api/controllers/ProjectController.ts";
import { TaskController } from "../../api/controllers/TaskController.ts";
import {
  taskAcceptParamsSchema,
  taskAcceptResultSchema,
  taskCompleteParamsSchema,
  taskCompleteResultSchema,
  taskCreateParamsSchema,
  taskCreateResultSchema,
  taskListParamsSchema,
  taskListResultSchema,
  taskUpdateParamsSchema,
  taskUpdateResultSchema,
} from "../schemas/index.ts";

/**
 * MCP tools for task operations.
 */
export class TaskTools {
  protected readonly taskController = $inject(TaskController);
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
   * Get task status from task data.
   */
  protected getTaskStatus(task: {
    acceptedAt?: string;
    completedAt?: string;
  }): "new" | "accepted" | "completed" {
    if (task.completedAt) return "completed";
    if (task.acceptedAt) return "accepted";
    return "new";
  }

  /**
   * List tasks for a project.
   */
  task_list = $tool({
    description:
      "List tasks for the project. Can filter by status (new, accepted, completed) and search by title.",
    schema: {
      params: taskListParamsSchema,
      result: taskListResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );

      const size = params.limit ?? 20;
      const page = params.offset ? Math.floor(params.offset / size) : 0;

      const result = await this.taskController.getTasks({
        params: { projectId },
        query: {
          status: params.status,
          search: params.search,
          size,
          page,
        },
      });

      return {
        tasks: result.content.map((task) => ({
          id: task.id,
          title: task.title,
          description: task.description,
          package: task.package,
          priority: task.priority,
          complexity: task.complexity,
          status: this.getTaskStatus(task),
          objectives: task.objectives,
          createdAt: task.createdAt,
          acceptedAt: task.acceptedAt,
          completedAt: task.completedAt,
        })),
        total: result.page.totalElements ?? 0,
        hasMore: !result.page.isLast,
      };
    },
  });

  /**
   * Create a new task.
   */
  task_create = $tool({
    description: "Create a new task in the project.",
    schema: {
      params: taskCreateParamsSchema,
      result: taskCreateResultSchema,
    },
    handler: async ({ params }) => {
      const projectId = await this.resolveProjectId(
        params.project,
        params.project_name,
      );

      const task = await this.taskController.createTask({
        body: {
          projectId,
          title: params.title,
          description: params.description,
          package: params.package,
          priority: params.priority,
          complexity: params.complexity,
          objectives: params.objectives,
        },
      });

      return {
        id: task.id,
        title: task.title,
        createdAt: task.createdAt,
      };
    },
  });

  /**
   * Accept a task (assign it to yourself).
   */
  task_accept = $tool({
    description:
      "Accept a task to start working on it. This assigns the task to you.",
    schema: {
      params: taskAcceptParamsSchema,
      result: taskAcceptResultSchema,
    },
    handler: async ({ params }) => {
      const task = await this.taskController.acceptTask({
        params: { id: params.id },
      });

      return {
        id: task.id,
        title: task.title,
        acceptedAt: task.acceptedAt!,
      };
    },
  });

  /**
   * Complete a task.
   */
  task_complete = $tool({
    description:
      "Mark a task as complete. All objectives must be completed first.",
    schema: {
      params: taskCompleteParamsSchema,
      result: taskCompleteResultSchema,
    },
    handler: async ({ params }) => {
      const result = await this.taskController.completeTask({
        params: { id: params.id },
      });

      // Calculate rewards from character delta
      const xpEarned = result.character?.xp;
      const moneyEarned = result.character?.balance;

      return {
        id: result.id,
        title: result.title,
        completedAt: result.completedAt!,
        xpEarned,
        moneyEarned,
      };
    },
  });

  /**
   * Update a task.
   */
  task_update = $tool({
    description:
      "Update a task's properties. Only non-completed tasks can be updated.",
    schema: {
      params: taskUpdateParamsSchema,
      result: taskUpdateResultSchema,
    },
    handler: async ({ params }) => {
      const task = await this.taskController.updateTaskById({
        params: { id: params.id },
        body: {
          title: params.title,
          description: params.description,
          package: params.package,
          priority: params.priority,
          complexity: params.complexity,
          objectives: params.objectives,
        },
      });

      return {
        id: task.id,
        title: task.title,
        updatedAt: task.updatedAt,
      };
    },
  });
}
