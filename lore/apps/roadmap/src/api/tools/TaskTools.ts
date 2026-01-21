import { $inject, t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $tool } from "alepha/mcp";
import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";
import sanitizeHtml from "sanitize-html";
import { characters } from "../entities/characters.ts";
import { projects } from "../entities/projects.ts";
import type { Task } from "../entities/tasks.ts";
import { tasks } from "../entities/tasks.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import { McpAuthProvider } from "../providers/McpAuthProvider.ts";
import { CharacterInfo } from "../services/CharacterInfo.ts";

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
 * MCP tools for task operations.
 *
 * These tools expose task management functionality to LLM clients
 * through the MCP protocol.
 */
export class TaskTools {
  protected readonly auth = $inject(McpAuthProvider);
  protected readonly tasks = $repository(tasks);
  protected readonly projects = $repository(projects);
  protected readonly characters = $repository(characters);
  protected readonly security = $inject(AppSecurityProvider);
  protected readonly dt = $inject(DateTimeProvider);
  protected readonly characterInfo = $inject(CharacterInfo);

  /**
   * List tasks for a project.
   */
  task_list = $tool({
    description:
      "List tasks for the project. Can filter by status (new, accepted, completed) and search by title.",
    schema: {
      params: t.object({
        ...projectParams,
        status: t.optional(
          t.enum(["new", "accepted", "completed"], {
            description: "Filter by task status",
          }),
        ),
        search: t.optional(
          t.string({
            description: "Search tasks by title",
          }),
        ),
        limit: t.optional(
          t.integer({
            description: "Maximum number of tasks to return (default: 20)",
            minimum: 1,
            maximum: 100,
          }),
        ),
        offset: t.optional(
          t.integer({
            description: "Number of tasks to skip for pagination",
            minimum: 0,
          }),
        ),
      }),
      result: t.object({
        tasks: t.array(
          t.object({
            id: t.integer(),
            title: t.string(),
            description: t.string(),
            package: t.string(),
            priority: t.enum(["optional", "low", "medium", "high"]),
            complexity: t.integer(),
            status: t.enum(["new", "accepted", "completed"]),
            objectives: t.array(
              t.object({
                title: t.string(),
                completed: t.boolean(),
              }),
            ),
            createdAt: t.datetime(),
            acceptedAt: t.optional(t.datetime()),
            completedAt: t.optional(t.datetime()),
          }),
        ),
        total: t.integer(),
        hasMore: t.boolean(),
      }),
    },
    handler: async ({ params, context }) => {
      const authContext = await this.auth.authenticate(context);
      const projectId = await this.auth.resolveProject(
        authContext,
        params.project,
        params.project_name,
      );

      const where = this.tasks.createQueryWhere();
      where.projectId = { eq: projectId };

      if (params.search) {
        where.title = { ilike: `%${params.search}%` };
      }

      if (params.status === "new") {
        where.acceptedAt = { isNull: true };
        where.completedAt = { isNull: true };
      } else if (params.status === "accepted") {
        where.acceptedAt = { isNotNull: true };
        where.completedAt = { isNull: true };
      } else if (params.status === "completed") {
        where.completedAt = { isNotNull: true };
      }

      const size = params.limit ?? 20;
      const page = params.offset ? Math.floor(params.offset / size) : 0;

      const result = await this.tasks.paginate(
        { page, size, sort: "-updatedAt" },
        { where },
      );

      const totalElements = result.page.totalElements ?? 0;

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
        total: totalElements,
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
      params: t.object({
        ...projectParams,
        title: t.string({
          description: "Task title",
        }),
        description: t.string({
          description: "Task description (supports HTML)",
        }),
        package: t.string({
          description: "Package/zone the task belongs to",
        }),
        priority: t.enum(["optional", "low", "medium", "high"], {
          description: "Task priority level",
        }),
        complexity: t.integer({
          description: "Task complexity (1-5)",
          minimum: 1,
          maximum: 5,
        }),
        objectives: t.optional(
          t.array(
            t.object({
              title: t.string(),
              completed: t.boolean(),
            }),
            {
              description: "List of objectives/subtasks",
            },
          ),
        ),
      }),
      result: t.object({
        id: t.integer(),
        title: t.string(),
        createdAt: t.datetime(),
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

      // sanitize HTML content
      const description = sanitizeHtml(params.description);

      if (params.package && !project.packages.includes(params.package)) {
        project.packages.push(params.package);
        await this.projects.updateById(project.id, {
          packages: project.packages,
        });
      }

      const task = await this.tasks.create({
        title: params.title,
        description,
        package: params.package,
        priority: params.priority,
        complexity: params.complexity,
        objectives: params.objectives ?? [],
        projectId,
        createdBy: authContext.user.id,
        history: [],
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
      params: t.object({
        id: t.integer({
          description: "Task ID to accept",
        }),
      }),
      result: t.object({
        id: t.integer(),
        title: t.string(),
        acceptedAt: t.datetime(),
      }),
    },
    handler: async ({ params, context }) => {
      const authContext = await this.auth.authenticate(context);

      const task = await this.tasks.findOne({
        where: {
          id: { eq: params.id },
          acceptedAt: { isNull: true },
          completedAt: { isNull: true },
        },
      });

      await this.security.checkOwnership(task.projectId, authContext.user);

      task.acceptedAt = this.dt.nowISOString();
      task.acceptedBy = authContext.user.id;
      task.history.push({
        at: this.dt.nowISOString(),
        by: authContext.user.id,
        action: "assigned",
      });

      await this.tasks.save(task);

      return {
        id: task.id,
        title: task.title,
        acceptedAt: task.acceptedAt,
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
      params: t.object({
        id: t.integer({
          description: "Task ID to complete",
        }),
      }),
      result: t.object({
        id: t.integer(),
        title: t.string(),
        completedAt: t.datetime(),
        xpEarned: t.optional(t.integer()),
        moneyEarned: t.optional(t.integer()),
      }),
    },
    handler: async ({ params, context }) => {
      const authContext = await this.auth.authenticate(context);

      return this.tasks.transaction(async (tx) => {
        const task = await this.tasks.findOne(
          {
            where: {
              id: { eq: params.id },
              completedAt: { isNull: true },
              acceptedAt: { isNotNull: true },
            },
          },
          { tx },
        );

        await this.security.checkOwnership(task.projectId, authContext.user);

        // Check if all objectives are completed
        if (task.objectives.length > 0) {
          const incompleteObjectives = task.objectives.filter(
            (obj) => !obj.completed,
          );
          if (incompleteObjectives.length > 0) {
            throw new BadRequestError(
              `Cannot complete task: ${incompleteObjectives.length} objective(s) remain incomplete`,
            );
          }
        }

        const character = await this.characters.findOne(
          {
            where: {
              projectId: { eq: task.projectId },
              userId: { eq: authContext.user.id },
            },
          },
          { tx },
        );

        const xp = this.characterInfo.getXpFromTask(task);
        const money = this.characterInfo.getMoneyFromTask(task);

        character.xp += xp;
        character.balance += money;
        task.completedAt = this.dt.nowISOString();
        task.completedBy = authContext.user.id;

        await Promise.all([
          this.characters.save(character, { tx }),
          this.tasks.save(task, { tx }),
        ]);

        return {
          id: task.id,
          title: task.title,
          completedAt: task.completedAt,
          xpEarned: xp,
          moneyEarned: money,
        };
      });
    },
  });

  /**
   * Update a task.
   */
  task_update = $tool({
    description:
      "Update a task's properties. Only non-completed tasks can be updated.",
    schema: {
      params: t.object({
        id: t.integer({
          description: "Task ID to update",
        }),
        title: t.optional(
          t.string({
            description: "New task title",
          }),
        ),
        description: t.optional(
          t.string({
            description: "New task description",
          }),
        ),
        package: t.optional(
          t.string({
            description: "New package/zone",
          }),
        ),
        priority: t.optional(
          t.enum(["optional", "low", "medium", "high"], {
            description: "New priority level",
          }),
        ),
        complexity: t.optional(
          t.integer({
            description: "New complexity (1-5)",
            minimum: 1,
            maximum: 5,
          }),
        ),
        objectives: t.optional(
          t.array(
            t.object({
              title: t.string(),
              completed: t.boolean(),
            }),
            {
              description: "Updated list of objectives",
            },
          ),
        ),
      }),
      result: t.object({
        id: t.integer(),
        title: t.string(),
        updatedAt: t.datetime(),
      }),
    },
    handler: async ({ params, context }) => {
      const authContext = await this.auth.authenticate(context);

      const task = await this.tasks.findOne({
        where: {
          id: { eq: params.id },
          completedAt: { isNull: true },
        },
      });

      await this.security.checkOwnership(task.projectId, authContext.user);

      const updates: Partial<Task> = {};

      if (params.title !== undefined) {
        updates.title = params.title;
      }
      if (params.description !== undefined) {
        updates.description = sanitizeHtml(params.description);
      }
      if (params.package !== undefined) {
        updates.package = params.package;
      }
      if (params.priority !== undefined) {
        updates.priority = params.priority;
      }
      if (params.complexity !== undefined) {
        updates.complexity = params.complexity;
      }
      if (params.objectives !== undefined) {
        updates.objectives = params.objectives;
      }

      updates.history = [
        ...task.history,
        {
          at: this.dt.nowISOString(),
          by: authContext.user.id,
          action: "updated" as const,
        },
      ];

      const updatedTask = await this.tasks.updateById(params.id, updates);

      return {
        id: updatedTask.id,
        title: updatedTask.title,
        updatedAt: updatedTask.updatedAt,
      };
    },
  });

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
}
