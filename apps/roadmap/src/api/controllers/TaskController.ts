import { $inject, t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, pageQuerySchema, pg } from "alepha/orm";
import { $action, BadRequestError, okSchema } from "alepha/server";
import sanitizeHtml from "sanitize-html";
import { characters } from "../entities/characters.ts";
import { projects } from "../entities/projects.ts";
import { tasks } from "../entities/tasks.ts";
import { taskVotes } from "../entities/taskVotes.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import { taskCreateSchema } from "../schemas/taskCreateSchema.ts";
import { CharacterInfo } from "../services/CharacterInfo.ts";

export class TaskController {
  log = $logger();
  tasks = $repository(tasks);
  taskVotes = $repository(taskVotes);
  projects = $repository(projects);
  characters = $repository(characters);
  characterInfo = $inject(CharacterInfo);
  dt = $inject(DateTimeProvider);
  security = $inject(AppSecurityProvider);

  createTask = $action({
    schema: {
      body: taskCreateSchema,
      response: tasks.schema,
    },
    handler: async ({ body, user }) => {
      const { project } = await this.security.checkOwnership(
        body.projectId,
        user,
      );

      // sanitize HTML content
      body.description = sanitizeHtml(body.description);

      if (body.package && !project.packages.includes(body.package)) {
        project.packages.push(body.package);
        await this.projects.updateById(project.id, {
          packages: project.packages,
        });
      }

      return await this.tasks.create({
        ...body,
        createdBy: user.id,
        history: [],
      });
    },
  });

  getTasks = $action({
    schema: {
      params: t.object({
        projectId: t.integer(),
      }),
      query: t.extend(pageQuerySchema, {
        status: t.optional(t.enum(["new", "accepted", "completed"])),
        search: t.optional(t.string()),
      }),
      response: pg.page(tasks.schema),
    },
    handler: async ({ params, query, user }) => {
      await this.security.checkOwnership(params.projectId, user);

      const where = this.tasks.createQueryWhere();
      where.projectId = { eq: params.projectId };

      if (query.search) {
        where.title = { ilike: `%${query.search}%` };
      }

      if (query.status === "new") {
        where.acceptedAt = { isNull: true };
        where.completedAt = { isNull: true };
      } else if (query.status === "accepted") {
        where.acceptedAt = { isNotNull: true };
        where.completedAt = { isNull: true };
      } else if (query.status === "completed") {
        where.completedAt = { isNotNull: true };
        query.sort ??= "-completedAt";
      }

      query.sort ??= "-updatedAt";

      return this.tasks.paginate(query, {
        where,
      });
    },
  });

  abandonTask = $action({
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: tasks.schema,
    },
    handler: async ({ params, user }) => {
      const task = await this.tasks.findOne({
        where: {
          id: { eq: params.id },
          acceptedAt: { isNotNull: true },
          completedAt: { isNull: true },
        },
      });

      await this.security.checkOwnership(task.projectId, user);

      task.acceptedAt = undefined;
      task.acceptedBy = undefined;
      task.history.push({
        at: this.dt.nowISOString(),
        by: user.id,
        action: "unassigned",
      });

      await this.tasks.save(task);
      return task;
    },
  });

  acceptTask = $action({
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: tasks.schema,
    },
    handler: async ({ params, user }) => {
      const task = await this.tasks.findOne({
        where: {
          id: { eq: params.id },
          acceptedAt: { isNull: true },
          completedAt: { isNull: true },
        },
      });

      await this.security.checkOwnership(task.projectId, user);

      task.acceptedAt = this.dt.nowISOString();
      task.acceptedBy = user.id;
      task.history.push({
        at: this.dt.nowISOString(),
        by: user.id,
        action: "assigned",
      });

      await this.tasks.save(task);
      return task;
    },
  });

  completeTask = $action({
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: t.extend(tasks.schema, {
        character: characters.schema,
      }),
    },
    handler: async ({ params, user }) => {
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

        await this.security.checkOwnership(task.projectId, user);

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
              userId: { eq: user.id },
            },
          },
          { tx },
        );

        const xp = this.characterInfo.getXpFromTask(task);
        const money = this.characterInfo.getMoneyFromTask(task);

        character.xp += xp;
        character.balance += money;
        task.completedAt = this.dt.nowISOString();
        task.completedBy = user.id;

        await Promise.all([
          this.characters.save(character, { tx }),
          this.tasks.save(task, { tx }),
        ]);

        return {
          ...task,
          character,
        };
      });
    },
  });

  getTaskById = $action({
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: tasks.schema,
    },
    handler: async ({ params, user }) => {
      const task = await this.tasks.findOne({
        where: {
          id: { eq: params.id },
        },
      });

      await this.security.checkOwnership(task.projectId, user);

      return task;
    },
  });

  updateTaskById = $action({
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.partial(
        t.pick(tasks.schema, [
          "title",
          "description",
          "package",
          "complexity",
          "priority",
          "objectives",
        ]),
      ),
      response: tasks.schema,
    },
    handler: async ({ params, body, user }) => {
      const task = await this.tasks.findOne({
        where: {
          id: { eq: params.id },
          completedAt: { isNull: true },
        },
      });

      await this.security.checkOwnership(task.projectId, user);

      // TODO: character.can("edit:task", projectId)

      if (body.description) {
        // sanitize HTML content
        body.description = sanitizeHtml(body.description);
      }

      return await this.tasks.updateById(params.id, {
        ...body,
        history: [
          ...task.history,
          {
            at: this.dt.nowISOString(),
            by: user.id,
            action: "updated",
          },
        ],
      });
    },
  });

  completeObjective = $action({
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        index: t.integer(),
      }),
      response: tasks.schema,
    },
    handler: async ({ params, user, body }) => {
      const task = await this.tasks.findOne({
        where: {
          id: { eq: params.id },
          completedAt: { isNull: true },
          acceptedAt: { isNotNull: true },
        },
      });

      await this.security.checkOwnership(task.projectId, user);

      if (body.index < 0 || body.index >= task.objectives.length) {
        throw new BadRequestError("Invalid objective index");
      }

      // Mark the specific objective as completed
      task.objectives[body.index].completed =
        !task.objectives[body.index].completed;

      return await this.tasks.updateById(params.id, {
        objectives: task.objectives,
        history: task.objectives[body.index].completed
          ? [
              ...task.history,
              {
                at: this.dt.nowISOString(),
                by: user.id,
                action: "objective_completed",
              },
            ]
          : task.history,
      });
    },
  });

  updateTaskObjectives = $action({
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        objectives: t.array(
          t.object({
            title: t.string(),
            completed: t.boolean(),
          }),
        ),
      }),
      response: tasks.schema,
    },
    handler: async ({ params, body, user }) => {
      const task = await this.tasks.findOne({
        where: {
          id: { eq: params.id },
          completedAt: { isNull: true },
        },
      });

      await this.security.checkOwnership(task.projectId, user);

      // TODO: character.can("edit:task", projectId)

      return await this.tasks.updateById(params.id, {
        objectives: body.objectives,
        history: [
          ...task.history,
          {
            at: this.dt.nowISOString(),
            by: user.id,
            action: "updated",
          },
        ],
      });
    },
  });

  deleteTask = $action({
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const task = await this.tasks.findOne({
        where: {
          id: { eq: params.id },
        },
      });

      await this.security.checkOwnership(task.projectId, user);

      // TODO: character.can("delete:task", projectId)

      await this.tasks.deleteById(params.id);

      return { ok: true };
    },
  });

  moveTaskToZone = $action({
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        newZone: t.string(),
      }),
      response: tasks.schema,
    },
    handler: async ({ params, body, user }) => {
      const task = await this.tasks.findOne({
        where: {
          id: { eq: params.id },
        },
      });

      await this.security.checkOwnership(task.projectId, user);

      // Update the task's package (zone)
      const updatedTask = await this.tasks.updateById(params.id, {
        package: body.newZone,
        history: [
          ...task.history,
          {
            at: this.dt.nowISOString(),
            by: user.id,
            action: "updated",
          },
        ],
      });

      // Ensure the new zone exists in the project's packages list
      const project = await this.projects.findById(task.projectId);
      if (!project.packages.includes(body.newZone)) {
        await this.projects.updateById(project.id, {
          packages: [...project.packages, body.newZone],
        });
      }

      return updatedTask;
    },
  });

  updateTaskNote = $action({
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        note: t.string({ size: "rich" }),
      }),
      response: tasks.schema,
    },
    handler: async ({ params, body, user }) => {
      const task = await this.tasks.findOne({
        where: {
          id: { eq: params.id },
        },
      });

      await this.security.checkOwnership(task.projectId, user);

      // sanitize HTML content
      const sanitizedNote = sanitizeHtml(body.note);

      return await this.tasks.updateById(params.id, {
        note: sanitizedNote,
      });
    },
  });

  startTimer = $action({
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: tasks.schema,
    },
    handler: async ({ params, user }) => {
      const task = await this.tasks.findOne({
        where: {
          id: { eq: params.id },
          acceptedAt: { isNotNull: true },
          completedAt: { isNull: true },
        },
      });

      await this.security.checkOwnership(task.projectId, user);

      // Check if timer is already running (last session has no stoppedAt)
      const sessions = task.timerSessions || [];
      const lastSession = sessions[sessions.length - 1];
      if (lastSession && !lastSession.stoppedAt) {
        throw new BadRequestError("Timer is already running");
      }

      // Add new timer session
      sessions.push({
        startedAt: this.dt.nowISOString(),
      });

      return await this.tasks.updateById(params.id, {
        timerSessions: sessions,
      });
    },
  });

  stopTimer = $action({
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: tasks.schema,
    },
    handler: async ({ params, user }) => {
      const task = await this.tasks.findOne({
        where: {
          id: { eq: params.id },
          acceptedAt: { isNotNull: true },
          completedAt: { isNull: true },
        },
      });

      await this.security.checkOwnership(task.projectId, user);

      // Find the running timer session
      const sessions = task.timerSessions || [];
      const lastSession = sessions[sessions.length - 1];
      if (!lastSession || lastSession.stoppedAt) {
        throw new BadRequestError("No timer is running");
      }

      // Stop the timer
      lastSession.stoppedAt = this.dt.nowISOString();

      return await this.tasks.updateById(params.id, {
        timerSessions: sessions,
      });
    },
  });

  upvoteTask = $action({
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: t.object({
        voted: t.boolean(),
        voteCount: t.integer(),
      }),
    },
    handler: async ({ params, user }) => {
      const task = await this.tasks.findOne({
        where: {
          id: { eq: params.id },
        },
      });

      await this.security.checkOwnership(task.projectId, user);

      // Check if user already voted
      const [existingVote] = await this.taskVotes.findMany({
        where: {
          taskId: { eq: params.id },
          userId: { eq: user.id },
        },
        limit: 1,
      });

      if (existingVote) {
        // Remove vote (toggle off)
        await this.taskVotes.deleteById(existingVote.id);
      } else {
        // Add vote
        await this.taskVotes.create({
          taskId: params.id,
          userId: user.id,
        });
      }

      // Get updated vote count
      const voteCount = await this.taskVotes.count({
        taskId: { eq: params.id },
      });

      return {
        voted: !existingVote,
        voteCount,
      };
    },
  });

  getTaskVotes = $action({
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: t.object({
        voted: t.boolean(),
        voteCount: t.integer(),
      }),
    },
    handler: async ({ params, user }) => {
      const task = await this.tasks.findOne({
        where: {
          id: { eq: params.id },
        },
      });

      await this.security.checkOwnership(task.projectId, user);

      // Check if user voted
      const [existingVote] = await this.taskVotes.findMany({
        where: {
          taskId: { eq: params.id },
          userId: { eq: user.id },
        },
        limit: 1,
      });

      // Get vote count
      const voteCount = await this.taskVotes.count({
        taskId: { eq: params.id },
      });

      return {
        voted: !!existingVote,
        voteCount,
      };
    },
  });
}
