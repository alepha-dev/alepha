import { $inject, t } from "alepha";
import { FileService } from "alepha/api/files";
import { $bucket } from "alepha/bucket";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, pageQuerySchema, pg } from "alepha/orm";
import { $action, BadRequestError, okSchema } from "alepha/server";
import sanitizeHtml from "sanitize-html";
import { characters } from "../entities/characters.ts";
import { projects } from "../entities/projects.ts";
import { tasks } from "../entities/tasks.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import { taskCreateSchema } from "../schemas/taskCreateSchema.ts";
import { CharacterInfo } from "../services/CharacterInfo.ts";

export class TaskController {
  log = $logger();
  tasks = $repository(tasks);
  projects = $repository(projects);
  characters = $repository(characters);
  characterInfo = $inject(CharacterInfo);
  dt = $inject(DateTimeProvider);
  security = $inject(AppSecurityProvider);
  fileService = $inject(FileService);

  attachments = $bucket({
    maxSize: 10 * 1024 * 1024, // 10 MB
    mimeTypes: [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
      "text/plain",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  });

  createTask = $action({
    secure: true,
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
        attachments: body.attachments ?? [],
        createdBy: user.id,
        history: [],
      });
    },
  });

  uploadAttachment = $action({
    secure: true,
    path: "/tasks/attachments",
    schema: {
      body: t.object({
        file: t.file(),
      }),
      response: t.object({
        fileId: t.uuid(),
        url: t.string(),
      }),
    },
    handler: async ({ body, user }) => {
      const file = await this.fileService.uploadFile(body.file, {
        user,
        bucket: this.attachments.name,
      });
      return {
        fileId: file.id,
        url: `/api/files/${file.id}`,
      };
    },
  });

  addAttachment = $action({
    secure: true,
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        fileId: t.uuid(),
      }),
      response: tasks.schema,
    },
    handler: async ({ params, body, user }) => {
      const task = await this.tasks.getOne({
        where: {
          id: { eq: params.id },
          completedAt: { isNull: true },
        },
      });

      await this.security.checkOwnership(task.projectId, user);

      if (task.attachments.includes(body.fileId)) {
        return task;
      }

      return await this.tasks.updateById(params.id, {
        attachments: [...task.attachments, body.fileId],
      });
    },
  });

  removeAttachment = $action({
    secure: true,
    schema: {
      params: t.object({
        id: t.integer(),
        fileId: t.uuid(),
      }),
      response: tasks.schema,
    },
    handler: async ({ params, user }) => {
      const task = await this.tasks.getOne({
        where: {
          id: { eq: params.id },
          completedAt: { isNull: true },
        },
      });

      await this.security.checkOwnership(task.projectId, user);

      const updatedAttachments = task.attachments.filter(
        (id) => id !== params.fileId,
      );

      // Delete the file from storage
      await this.fileService.deleteFile(params.fileId).catch(() => {
        // File may not exist or already deleted
      });

      return await this.tasks.updateById(params.id, {
        attachments: updatedAttachments,
      });
    },
  });

  getTasks = $action({
    secure: true,
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
    secure: true,
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: tasks.schema,
    },
    handler: async ({ params, user }) => {
      const task = await this.tasks.getOne({
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
    secure: true,
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: tasks.schema,
    },
    handler: async ({ params, user }) => {
      const task = await this.tasks.getOne({
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
    secure: true,
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
        const task = await this.tasks.getOne(
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

        const character = await this.characters.getOne(
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
    secure: true,
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: tasks.schema,
    },
    handler: async ({ params, user }) => {
      const task = await this.tasks.getOne({
        where: {
          id: { eq: params.id },
        },
      });

      await this.security.checkOwnership(task.projectId, user);

      return task;
    },
  });

  updateTaskById = $action({
    secure: true,
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
          "attachments",
        ]),
      ),
      response: tasks.schema,
    },
    handler: async ({ params, body, user }) => {
      const task = await this.tasks.getOne({
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
    secure: true,
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
      const task = await this.tasks.getOne({
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
    secure: true,
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
      const task = await this.tasks.getOne({
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
    secure: true,
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const task = await this.tasks.getOne({
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
    secure: true,
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
      const task = await this.tasks.getOne({
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
      const project = await this.projects.getById(task.projectId);
      if (!project.packages.includes(body.newZone)) {
        await this.projects.updateById(project.id, {
          packages: [...project.packages, body.newZone],
        });
      }

      return updatedTask;
    },
  });

  updateTaskNote = $action({
    secure: true,
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
      const task = await this.tasks.getOne({
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
    secure: true,
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: tasks.schema,
    },
    handler: async ({ params, user }) => {
      const task = await this.tasks.getOne({
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
    secure: true,
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: tasks.schema,
    },
    handler: async ({ params, user }) => {
      const task = await this.tasks.getOne({
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
}
