import { $inject, t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, DatabaseProvider, sql } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, BadRequestError, okSchema } from "alepha/server";
import { $etag } from "alepha/server/etag";
import { chapters } from "../entities/chapters.ts";
import { tasks } from "../entities/tasks.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";

export class ChapterController {
  log = $logger();
  chapters = $repository(chapters);
  tasks = $repository(tasks);
  database = $inject(DatabaseProvider);
  dt = $inject(DateTimeProvider);
  security = $inject(AppSecurityProvider);

  getChapters = $action({
    use: [
      $secure({ permissions: ["task:read"] }),
      $etag({
        control: { private: true, maxAge: 30, staleWhileRevalidate: 120 },
      }),
    ],
    schema: {
      params: t.object({
        projectId: t.integer(),
      }),
      response: t.array(
        t.extend(chapters.schema, {
          questCount: t.integer(),
        }),
      ),
    },
    handler: async ({ params, user }) => {
      await this.security.checkOwnership(params.projectId, user);

      const allChapters = await this.chapters.findMany({
        where: {
          projectId: { eq: params.projectId },
        },
        orderBy: [{ column: "number", direction: "desc" }],
      });

      const chapterIds = allChapters.map((c) => c.id);
      const countMap = new Map<number, number>();

      if (chapterIds.length > 0) {
        const counts = await this.chapters.query(
          sql`
            SELECT ${this.tasks.table.chapterId} as "chapterId", COUNT(*) as count
            FROM ${this.tasks.table}
            WHERE ${this.tasks.table.chapterId} IN ${chapterIds}
            GROUP BY ${this.tasks.table.chapterId}
          `,
          t.object({
            chapterId: t.integer(),
            count: t.string(),
          }),
        );

        for (const row of counts) {
          countMap.set(row.chapterId, Number(row.count));
        }
      }

      return allChapters.map((ch) => ({
        ...ch,
        questCount: countMap.get(ch.id) ?? 0,
      }));
    },
  });

  startChapter = $action({
    use: [$secure({ permissions: ["task:create"] })],
    schema: {
      params: t.object({
        projectId: t.integer(),
      }),
      body: t.object({
        title: t.optional(t.string({ minLength: 1, maxLength: 100 })),
        description: t.optional(t.string({ size: "rich" })),
      }),
      response: chapters.schema,
    },
    handler: async ({ params, body, user }) => {
      await this.security.checkOwnership(params.projectId, user);

      // Check no active chapter exists
      const active = await this.chapters.findMany({
        where: {
          projectId: { eq: params.projectId },
          closedAt: { isNull: true },
        },
      });

      if (active.length > 0) {
        throw new BadRequestError(
          "An active chapter already exists. Close it before starting a new one.",
        );
      }

      // Compute next number
      const existing = await this.chapters.findMany({
        where: {
          projectId: { eq: params.projectId },
        },
        orderBy: [{ column: "number", direction: "desc" }],
        limit: 1,
      });

      const nextNumber = existing.length > 0 ? existing[0].number + 1 : 1;

      return await this.chapters.create({
        projectId: params.projectId,
        number: nextNumber,
        title: body.title || randomChapterName(),
        description: body.description ?? "",
      });
    },
  });

  closeChapter = $action({
    use: [$secure({ permissions: ["task:create"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        title: t.optional(t.string({ minLength: 1, maxLength: 100 })),
      }),
      response: chapters.schema,
    },
    handler: async ({ params, body, user }) => {
      const chapter = await this.chapters.getById(params.id);
      await this.security.checkOwnership(chapter.projectId, user);

      if (chapter.closedAt) {
        throw new BadRequestError("Chapter is already closed.");
      }

      return await this.chapters.updateById(params.id, {
        closedAt: this.dt.nowISOString(),
        ...(body.title ? { title: body.title } : {}),
      });
    },
  });

  deleteChapter = $action({
    use: [$secure({ permissions: ["task:delete"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const chapter = await this.chapters.getById(params.id);
      await this.security.checkOwnership(chapter.projectId, user);

      // Only allow deleting empty chapters
      const attachedTasks = await this.tasks.findMany({
        where: {
          chapterId: { eq: chapter.id },
        },
        columns: ["id"],
        limit: 1,
      });

      if (attachedTasks.length > 0) {
        throw new BadRequestError(
          "Cannot delete a chapter that has quests attached.",
        );
      }

      await this.chapters.deleteById(params.id);
      return { ok: true };
    },
  });

  getChapterChangelog = $action({
    use: [
      $secure({ permissions: ["task:read"] }),
      $etag({
        control: { private: true, maxAge: 60, staleWhileRevalidate: 600 },
      }),
    ],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: t.object({
        markdown: t.string(),
        chapter: chapters.schema,
        stats: t.object({
          questCount: t.integer(),
          zoneCount: t.integer(),
          contributorCount: t.integer(),
        }),
      }),
    },
    handler: async ({ params, user }) => {
      const chapter = await this.chapters.getById(params.id);
      await this.security.checkOwnership(chapter.projectId, user);

      const chapterTasks = await this.tasks.findMany({
        where: {
          chapterId: { eq: chapter.id },
        },
      });

      // Group by zone
      const byZone = new Map<string, typeof chapterTasks>();
      for (const task of chapterTasks) {
        const zone = task.package || "Uncategorized";
        if (!byZone.has(zone)) {
          byZone.set(zone, []);
        }
        byZone.get(zone)!.push(task);
      }

      // Collect unique contributors
      const contributors = new Set<string>();
      for (const task of chapterTasks) {
        if (task.completedBy) contributors.add(task.completedBy);
      }

      // Build markdown
      const lines: string[] = [];
      lines.push(`# Chapter ${chapter.number}: ${chapter.title}`);
      lines.push("");

      if (chapter.description) {
        lines.push(chapter.description);
        lines.push("");
      }

      lines.push(
        `> ${chapterTasks.length} quest(s) completed across ${byZone.size} zone(s) by ${contributors.size} adventurer(s)`,
      );
      lines.push("");

      for (const [zone, zoneTasks] of byZone) {
        lines.push(`## ${zone}`);
        lines.push("");
        for (const task of zoneTasks) {
          const priority =
            task.priority !== "optional" ? ` [${task.priority}]` : "";
          lines.push(`- ${task.title}${priority}`);
        }
        lines.push("");
      }

      return {
        markdown: lines.join("\n"),
        chapter,
        stats: {
          questCount: chapterTasks.length,
          zoneCount: byZone.size,
          contributorCount: contributors.size,
        },
      };
    },
  });
}

const PREFIXES = [
  "The Fall of",
  "Rise of the",
  "Whispers of",
  "The Siege of",
  "Beyond the",
  "Echoes of",
  "The Last",
  "Dawn of",
  "Shadows over",
  "The Trials of",
  "Wrath of the",
  "Ashes of",
  "The Sundering of",
  "Secrets of the",
  "Into the",
  "The Awakening of",
  "Curse of the",
  "March on",
  "Beneath the",
  "Legacy of the",
];

const SUBJECTS = [
  "Stormhold",
  "Iron Citadel",
  "Forgotten Realm",
  "Ancient Grove",
  "Crimson Keep",
  "Shattered Throne",
  "Obsidian Spire",
  "Hollow Mountain",
  "Ember Wastes",
  "Frozen Reach",
  "Twilight Depths",
  "Verdant Wilds",
  "Sunken Temple",
  "Ashen Lands",
  "Crystal Sanctum",
  "Dragonspine",
  "Thornwall",
  "Moonlit Ruins",
  "Gilded Tomb",
  "Wraithwood",
];

function randomChapterName(): string {
  const prefix = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
  const subject = SUBJECTS[Math.floor(Math.random() * SUBJECTS.length)];
  return `${prefix} ${subject}`;
}
