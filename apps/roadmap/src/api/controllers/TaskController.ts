import { $inject, t } from "alepha";
import { FileService } from "alepha/api/files";
import { $bucket } from "alepha/bucket";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, db, pageQuerySchema } from "alepha/orm";
import { $secure } from "alepha/security";
import {
  $action,
  BadRequestError,
  ForbiddenError,
  okSchema,
} from "alepha/server";
import { chapters } from "../entities/chapters.ts";
import { characters } from "../entities/characters.ts";
import { projects } from "../entities/projects.ts";
import { type Task, tasks } from "../entities/tasks.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import { taskCreateSchema } from "../schemas/taskCreateSchema.ts";
import {
  type TaskResource,
  taskResourceSchema,
} from "../schemas/taskResourceSchema.ts";
import { CharacterInfo } from "../services/CharacterInfo.ts";
import { TaskResourceMapper } from "../services/TaskResourceMapper.ts";

/**
 * Tags matching what TipTap StarterKit + Mantine controls produce.
 */
const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "em",
  "u",
  "s",
  "mark",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "hr",
]);

const sanitizeHtml = (html: string) => {
  return html
    .replace(/<script[\s>][\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s>][\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*\/?>/gi, (match, tag: string) => {
      const lower = tag.toLowerCase();
      if (!ALLOWED_TAGS.has(lower)) return "";
      if (match.startsWith("</")) return `</${lower}>`;
      if (lower === "br" || lower === "hr") return `<${lower}>`;
      return `<${lower}>`;
    });
};

export class TaskController {
  log = $logger();
  tasks = $repository(tasks);
  projects = $repository(projects);
  characters = $repository(characters);
  chapters = $repository(chapters);
  characterInfo = $inject(CharacterInfo);
  dt = $inject(DateTimeProvider);
  security = $inject(AppSecurityProvider);
  fileService = $inject(FileService);
  taskMapper = $inject(TaskResourceMapper);

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

  /**
   * Enrich a task entity with computed metadata.
   */
  mapTaskToResource(task: Task): TaskResource {
    return this.taskMapper.mapTaskToResource(task);
  }

  createTask = $action({
    use: [$secure({ permissions: ["task:create"] })],
    schema: {
      body: taskCreateSchema,
      response: taskResourceSchema,
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

      const task = await this.tasks.create({
        ...body,
        attachments: body.attachments ?? [],
        createdBy: user.id,
        history: [],
      });

      return this.mapTaskToResource(task);
    },
  });

  uploadAttachment = $action({
    use: [$secure({ permissions: ["task:create"] })],
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
    use: [$secure({ permissions: ["task:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        fileId: t.uuid(),
      }),
      response: taskResourceSchema,
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
        return this.mapTaskToResource(task);
      }

      const updated = await this.tasks.updateById(params.id, {
        attachments: [...task.attachments, body.fileId],
      });

      return this.mapTaskToResource(updated);
    },
  });

  removeAttachment = $action({
    use: [$secure({ permissions: ["task:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
        fileId: t.uuid(),
      }),
      response: taskResourceSchema,
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

      const updated = await this.tasks.updateById(params.id, {
        attachments: updatedAttachments,
      });

      return this.mapTaskToResource(updated);
    },
  });

  getTasks = $action({
    use: [$secure({ permissions: ["task:read"] })],
    schema: {
      params: t.object({
        projectId: t.integer(),
      }),
      query: t.extend(pageQuerySchema, {
        status: t.optional(t.enum(["new", "accepted", "completed"])),
        search: t.optional(t.string()),
        chapterId: t.optional(t.integer()),
        package: t.optional(t.string()),
      }),
      response: db.page(taskResourceSchema),
    },
    handler: async ({ params, query, user }) => {
      await this.security.checkOwnership(params.projectId, user);

      const where = this.tasks.createQueryWhere();
      where.projectId = { eq: params.projectId };

      if (query.search) {
        where.title = { ilike: `%${query.search}%` };
      }

      if (query.chapterId) {
        where.chapterId = { eq: query.chapterId };
      }

      if (query.package) {
        where.package = { eq: query.package };
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

      const result = await this.tasks.paginate(
        query,
        {
          where,
        },
        { count: true },
      );

      return {
        ...result,
        content: result.content.map((task) => this.mapTaskToResource(task)),
      };
    },
  });

  abandonTask = $action({
    use: [$secure({ permissions: ["task:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: taskResourceSchema,
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
      return this.mapTaskToResource(task);
    },
  });

  acceptTask = $action({
    use: [$secure({ permissions: ["task:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: taskResourceSchema,
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
      return this.mapTaskToResource(task);
    },
  });

  completeTask = $action({
    use: [$secure({ permissions: ["task:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: t.extend(taskResourceSchema, {
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

        // Auto-attach to active chapter
        const activeChapters = await this.chapters.findMany(
          {
            where: {
              projectId: { eq: task.projectId },
              closedAt: { isNull: true },
            },
            limit: 1,
          },
          { tx },
        );

        if (activeChapters.length > 0) {
          task.chapterId = activeChapters[0].id;
        }

        await Promise.all([
          this.characters.save(character, { tx }),
          this.tasks.save(task, { tx }),
        ]);

        return {
          ...this.mapTaskToResource(task),
          character,
        };
      });
    },
  });

  getTaskById = $action({
    use: [$secure({ permissions: ["task:read"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: taskResourceSchema,
    },
    handler: async ({ params, user }) => {
      const task = await this.tasks.getOne({
        where: {
          id: { eq: params.id },
        },
      });

      await this.security.checkOwnership(task.projectId, user);

      return this.mapTaskToResource(task);
    },
  });

  updateTaskById = $action({
    use: [$secure({ permissions: ["task:update"] })],
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
      response: taskResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const task = await this.tasks.getOne({
        where: {
          id: { eq: params.id },
          completedAt: { isNull: true },
        },
      });

      const { project } = await this.security.checkOwnership(
        task.projectId,
        user,
      );

      if (task.createdBy !== user.id && project.createdBy !== user.id) {
        throw new ForbiddenError(
          "Only the quest creator or campaign owner can edit this quest",
        );
      }

      if (body.description) {
        // sanitize HTML content
        body.description = sanitizeHtml(body.description);
      }

      const updated = await this.tasks.updateById(params.id, {
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

      return this.mapTaskToResource(updated);
    },
  });

  completeObjective = $action({
    use: [$secure({ permissions: ["task:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        index: t.integer(),
      }),
      response: taskResourceSchema,
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

      const updated = await this.tasks.updateById(params.id, {
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

      return this.mapTaskToResource(updated);
    },
  });

  updateTaskObjectives = $action({
    use: [$secure({ permissions: ["task:update"] })],
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
      response: taskResourceSchema,
    },
    handler: async ({ params, body, user }) => {
      const task = await this.tasks.getOne({
        where: {
          id: { eq: params.id },
          completedAt: { isNull: true },
        },
      });

      const { project } = await this.security.checkOwnership(
        task.projectId,
        user,
      );

      if (task.createdBy !== user.id && project.createdBy !== user.id) {
        throw new ForbiddenError(
          "Only the quest creator or campaign owner can edit objectives",
        );
      }

      const updated = await this.tasks.updateById(params.id, {
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

      return this.mapTaskToResource(updated);
    },
  });

  deleteTask = $action({
    use: [$secure({ permissions: ["task:delete"] })],
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

      const { project } = await this.security.checkOwnership(
        task.projectId,
        user,
      );

      if (task.createdBy !== user.id && project.createdBy !== user.id) {
        throw new ForbiddenError(
          "Only the quest creator or campaign owner can delete this quest",
        );
      }

      await this.tasks.deleteById(params.id);

      return { ok: true };
    },
  });

  moveTaskToZone = $action({
    use: [$secure({ permissions: ["task:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        newZone: t.string(),
      }),
      response: taskResourceSchema,
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

      return this.mapTaskToResource(updatedTask);
    },
  });

  updateTaskNote = $action({
    use: [$secure({ permissions: ["task:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        note: t.string({ size: "rich" }),
      }),
      response: taskResourceSchema,
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

      const updated = await this.tasks.updateById(params.id, {
        note: sanitizedNote,
      });

      return this.mapTaskToResource(updated);
    },
  });

  startTimer = $action({
    use: [$secure({ permissions: ["task:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: taskResourceSchema,
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

      const updated = await this.tasks.updateById(params.id, {
        timerSessions: sessions,
      });

      return this.mapTaskToResource(updated);
    },
  });

  stopTimer = $action({
    use: [$secure({ permissions: ["task:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: taskResourceSchema,
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

      const updated = await this.tasks.updateById(params.id, {
        timerSessions: sessions,
      });

      return this.mapTaskToResource(updated);
    },
  });
}
