import { $inject, t } from "alepha";
import { users } from "alepha/api/users";
import { $logger } from "alepha/logger";
import { $repository, pageQuerySchema } from "alepha/orm";
import { $secure } from "alepha/security";
import {
  $action,
  BadRequestError,
  ForbiddenError,
  okSchema,
} from "alepha/server";
import { FileSystemProvider } from "alepha/system";
import { chapters } from "../entities/chapters.ts";
import { type Character, characters } from "../entities/characters.ts";
import { projects } from "../entities/projects.ts";
import { tasks } from "../entities/tasks.ts";
import type { User } from "../entities/users.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";
import { taskResourceSchema } from "../schemas/taskResourceSchema.ts";
import { TaskResourceMapper } from "../services/TaskResourceMapper.ts";

export class ProjectController {
  log = $logger();
  projects = $repository(projects);
  characters = $repository(characters);
  tasks = $repository(tasks);
  chapters = $repository(chapters);
  users = $repository(users);
  security = $inject(AppSecurityProvider);
  fs = $inject(FileSystemProvider);
  taskMapper = $inject(TaskResourceMapper);

  createProject = $action({
    use: [$secure({ permissions: ["project:create"] })],
    schema: {
      body: t.pick(projects.insertSchema, ["title", "public"]),
      response: projects.schema,
    },
    handler: async ({ body, user }) => {
      // TODO: load user + check if they have a free project slot

      const count = await this.projects.count({
        createdBy: { eq: user.id },
      });

      if (count >= 5) {
        throw new ForbiddenError(
          "You have reached the maximum number of projects allowed.",
        );
      }

      const project = await this.projects.create({
        ...body,
        createdBy: user.id,
      });

      await this.characters.create({
        projectId: project.id,
        userId: user.id,
        xp: 0,
        balance: 0,
        owner: true,
      });

      return project;
    },
  });

  getMyProjects = $action({
    use: [$secure({ permissions: ["project:read"] })],
    description: "Get all projects for the authenticated user",
    schema: {
      query: pageQuerySchema,
      response: t.array(projects.schema),
    },
    handler: async ({ user }) => {
      const userCharacters = await this.characters.findMany({
        where: { userId: { eq: user.id } },
      });

      const characterProjectIds = userCharacters.map((it) => it.projectId);
      if (characterProjectIds.length === 0) {
        return [];
      }

      return await this.projects.findMany({
        where: { id: { inArray: characterProjectIds } },
        limit: characterProjectIds.length,
      });
    },
  });

  // -------------------------------------------------------------------------------------------------------------------

  getProjectUsers = $action({
    use: [$secure({ permissions: ["project:read"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: t.array(users.schema),
    },
    handler: async ({ params, user }) => {
      await this.security.checkOwnership(params.id, user);

      const projectCharacters = await this.characters.findMany({
        where: { projectId: { eq: params.id } },
      });

      const userIds = projectCharacters.map((it) => it.userId);

      return await this.users.findMany({
        where: { id: { inArray: userIds } },
        limit: userIds.length,
      });
    },
  });

  updateProjectById = $action({
    use: [$secure({ permissions: ["project:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.partial(t.pick(projects.insertSchema, ["title", "public"])),
      response: projects.schema,
    },
    handler: async ({ params, body, user }) => {
      const { project } = await this.security.checkOwnership(params.id, user);

      if (body.title) {
        project.title = body.title.trim();
      }

      if (body.public != null) {
        project.public = body.public;
      }

      await this.projects.save(project);
      return project;
    },
  });

  getProjectById = $action({
    use: [$secure({ permissions: ["project:read"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: t.extend(projects.schema, {
        character: t.optional(characters.schema),
        tasks: t.array(taskResourceSchema),
      }),
    },
    handler: async ({ params, user }) => {
      const { project } = await this.security.checkOwnership(params.id, user);

      const character = await this.characters.findOne({
        where: {
          projectId: { eq: params.id },
          userId: { eq: user.id },
        },
      });

      if (!character && !project.public) {
        throw new ForbiddenError("Not a member of this project");
      }

      const projectTasks = await this.tasks.findMany({
        where: {
          projectId: { eq: params.id },
          completedAt: { isNull: true },
          acceptedBy: { eq: user.id },
        },
      });

      return {
        ...project,
        tasks: projectTasks.map((task) =>
          this.taskMapper.mapTaskToResource(task),
        ),
        character,
      };
    },
  });

  getProjectPlayers = $action({
    use: [$secure({ permissions: ["project:read"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: t.array(
        t.extend(characters.schema, {
          user: users.schema,
        }),
      ),
    },
    handler: async ({ params, user }) => {
      await this.security.checkOwnership(params.id, user);

      const projectCharacters = await this.characters.findMany({
        where: { projectId: { eq: params.id } },
      });

      const projectUsers = await this.users.findMany({
        limit: projectCharacters.length,
        where: {
          id: { inArray: projectCharacters.map((char) => char.userId) },
        },
      });

      const charactersWithUsers: Array<
        Character & {
          user: User;
        }
      > = [];

      for (const character of projectCharacters) {
        const characterUser = projectUsers.find(
          (it) => it.id === character.userId,
        );
        if (!characterUser) {
          this.log.warn(
            `User with id ${character.userId} not found for character ${character.id}`,
          );
          continue;
        }
        charactersWithUsers.push({
          ...character,
          user: characterUser,
        });
      }

      // Sort by owner first, then by creation date
      return charactersWithUsers.sort((a, b) => {
        if (a.owner && !b.owner) return -1;
        if (!a.owner && b.owner) return 1;
        return (
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      });
    },
  });

  deleteProjectById = $action({
    use: [$secure({ permissions: ["project:delete"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      await this.security.checkOwnership(params.id, user);

      await this.projects.deleteById(params.id);
      await this.characters.deleteMany({
        projectId: { eq: params.id },
      });
      await this.tasks.deleteMany({
        projectId: { eq: params.id },
      });

      return { ok: true };
    },
  });

  renameZone = $action({
    use: [$secure({ permissions: ["project:update"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        oldZoneName: t.string(),
        newZoneName: t.string({ minLength: 1 }),
      }),
      response: okSchema,
    },
    handler: async ({ params, body, user }) => {
      const { project } = await this.security.checkOwnership(params.id, user);

      // Update all tasks with the old package name to the new one
      const tasksToUpdate = await this.tasks.findMany({
        where: {
          projectId: { eq: params.id },
          package: { eq: body.oldZoneName },
        },
      });

      // Update each task's package field
      for (const task of tasksToUpdate) {
        await this.tasks.updateById(task.id, {
          package: body.newZoneName,
        });
      }

      // Update the project's packages array
      const updatedPackages = project.packages.map((pkg) =>
        pkg === body.oldZoneName ? body.newZoneName : pkg,
      );

      await this.projects.updateById(params.id, {
        packages: updatedPackages,
      });

      return { ok: true };
    },
  });

  // -------------------------------------------------------------------------------------------------------------------

  backupProject = $action({
    use: [$secure({ permissions: ["project:read"] })],
    path: "/projects/:id/backup",
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: t.file(),
    },
    handler: async ({ params, user }) => {
      const { project } = await this.security.checkOwnership(params.id, user);

      const projectTasks = await this.tasks.findMany({
        where: { projectId: { eq: params.id } },
        orderBy: "createdAt",
        limit: 10000,
      });

      const projectChapters = await this.chapters.findMany({
        where: { projectId: { eq: params.id } },
        orderBy: [{ column: "number", direction: "asc" }],
      });

      const chapterIdToTaskIndices = new Map<number, number[]>();
      for (let i = 0; i < projectTasks.length; i++) {
        const task = projectTasks[i];
        if (task.chapterId) {
          if (!chapterIdToTaskIndices.has(task.chapterId)) {
            chapterIdToTaskIndices.set(task.chapterId, []);
          }
          chapterIdToTaskIndices.get(task.chapterId)!.push(i);
        }
      }

      const backup = {
        version: 1,
        exportedAt: new Date().toISOString(),
        project: {
          title: project.title,
          packages: project.packages,
          public: project.public ?? false,
        },
        chapters: projectChapters.map((ch) => ({
          number: ch.number,
          title: ch.title,
          description: ch.description,
          closedAt: ch.closedAt ?? null,
          tasks: chapterIdToTaskIndices.get(ch.id) ?? [],
        })),
        tasks: projectTasks.map((task) => ({
          title: task.title,
          description: task.description,
          package: task.package,
          priority: task.priority,
          complexity: task.complexity,
          objectives: task.objectives,
          note: task.note,
          acceptedAt: task.acceptedAt ?? null,
          completedAt: task.completedAt ?? null,
          history: task.history,
          timerSessions: task.timerSessions,
        })),
      };

      return this.fs.createFile({
        text: JSON.stringify(backup, null, 2),
        name: `backup-${project.title}-${new Date().toISOString().split("T")[0]}.json`,
        type: "application/json",
      });
    },
  });

  importProject = $action({
    use: [$secure({ permissions: ["project:create"] })],
    path: "/projects/import",
    schema: {
      body: t.object({
        version: t.integer(),
        exportedAt: t.string(),
        project: t.object({
          title: t.string({ minLength: 3, maxLength: 24 }),
          packages: t.array(t.string()),
          public: t.optional(t.boolean()),
        }),
        chapters: t.array(
          t.object({
            number: t.integer(),
            title: t.string(),
            description: t.optional(t.string()),
            closedAt: t.optional(t.nullable(t.string())),
            tasks: t.array(t.integer()),
          }),
        ),
        tasks: t.array(
          t.object({
            title: t.string(),
            description: t.string(),
            package: t.string(),
            priority: t.enum(["optional", "low", "medium", "high"]),
            complexity: t.integer({ minimum: 1, maximum: 5 }),
            objectives: t.array(
              t.object({
                title: t.string(),
                completed: t.boolean(),
              }),
            ),
            note: t.optional(t.string()),
            acceptedAt: t.optional(t.nullable(t.string())),
            completedAt: t.optional(t.nullable(t.string())),
            history: t.optional(
              t.array(
                t.object({
                  at: t.string(),
                  by: t.string(),
                  action: t.string(),
                }),
              ),
            ),
            timerSessions: t.optional(
              t.array(
                t.object({
                  startedAt: t.string(),
                  stoppedAt: t.optional(t.nullable(t.string())),
                }),
              ),
            ),
          }),
        ),
      }),
      response: projects.schema,
    },
    handler: async ({ body, user }) => {
      if (body.version !== 1) {
        throw new BadRequestError("Unsupported backup version.");
      }

      const count = await this.projects.count({
        createdBy: { eq: user.id },
      });

      if (count >= 5) {
        throw new ForbiddenError(
          "You have reached the maximum number of projects allowed.",
        );
      }

      const project = await this.projects.create({
        title: body.project.title,
        packages: body.project.packages,
        public: body.project.public ?? false,
        createdBy: user.id,
      });

      await this.characters.create({
        projectId: project.id,
        userId: user.id,
        xp: 0,
        balance: 0,
        owner: true,
      });

      const chapterIdMap = new Map<number, number>();
      for (const ch of body.chapters) {
        const created = await this.chapters.create({
          projectId: project.id,
          number: ch.number,
          title: ch.title,
          description: ch.description ?? "",
          ...(ch.closedAt ? { closedAt: ch.closedAt } : {}),
        });
        chapterIdMap.set(ch.number, created.id);
      }

      const taskChapterMap = new Map<number, number>();
      for (const ch of body.chapters) {
        const chapterId = chapterIdMap.get(ch.number);
        if (chapterId) {
          for (const taskIndex of ch.tasks) {
            taskChapterMap.set(taskIndex, chapterId);
          }
        }
      }

      for (let i = 0; i < body.tasks.length; i++) {
        const task = body.tasks[i];
        await this.tasks.create({
          projectId: project.id,
          chapterId: taskChapterMap.get(i) ?? null,
          title: task.title,
          description: task.description,
          package: task.package,
          priority: task.priority,
          complexity: task.complexity,
          objectives: task.objectives,
          note: task.note ?? "",
          acceptedAt: task.acceptedAt ?? null,
          acceptedBy: task.acceptedAt ? user.id : null,
          completedAt: task.completedAt ?? null,
          completedBy: task.completedAt ? user.id : null,
          createdBy: user.id,
          history: (task.history as any) ?? [],
          timerSessions: (task.timerSessions as any) ?? [],
          attachments: [],
        } as any);
      }

      return project;
    },
  });
}
