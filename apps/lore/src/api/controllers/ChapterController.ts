import { $inject, t } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, $sequence, $transactional } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, BadRequestError, okSchema } from "alepha/server";
import { $etag } from "alepha/server/etag";
import { campaigns } from "../entities/campaigns.ts";
import { type Chapter, chapters } from "../entities/chapters.ts";
import { type Quest, quests } from "../entities/quests.ts";
import { AppSecurityProvider } from "../providers/AppSecurityProvider.ts";

export class ChapterController {
  log = $logger();
  chapters = $repository(chapters);
  quests = $repository(quests);
  campaigns = $repository(campaigns);
  dt = $inject(DateTimeProvider);
  security = $inject(AppSecurityProvider);

  /**
   * Per-campaign sequence for `chapters.number`. Replaces the old MAX+1
   * lookup with an atomic counter — race-safe even under concurrent starts.
   */
  protected chapterNumber = $sequence();

  getChapters = $action({
    use: [
      $secure({ permissions: ["quest:read"] }),
      $etag({
        control: { private: true, maxAge: 30, staleWhileRevalidate: 120 },
      }),
    ],
    schema: {
      params: t.object({
        campaignId: t.integer(),
      }),
      response: t.array(
        t.extend(chapters.schema, {
          questCount: t.integer(),
        }),
      ),
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.campaignId, user);

      const allChapters = await this.chapters.findMany({
        where: {
          campaignId: { eq: params.campaignId },
        },
        orderBy: [{ column: "number", direction: "desc" }],
      });

      const counts = await Promise.all(
        allChapters.map((ch) => this.countCompletedInWindow(ch)),
      );

      return allChapters.map((ch, i) => ({
        ...ch,
        questCount: counts[i],
      }));
    },
  });

  startChapter = $action({
    use: [$secure({ permissions: ["quest:create"] }), $transactional()],
    schema: {
      params: t.object({
        campaignId: t.integer(),
      }),
      body: t.object({
        title: t.optional(t.string({ minLength: 1, maxLength: 100 })),
        description: t.optional(t.string({ size: "rich" })),
        tags: t.optional(t.array(t.string())),
      }),
      response: chapters.schema,
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertOwner(params.campaignId, user);

      const active = await this.chapters.findMany({
        where: {
          campaignId: { eq: params.campaignId },
          closedAt: { isNull: true },
        },
      });

      if (active.length > 0) {
        throw new BadRequestError(
          "An active chapter already exists. Close it before starting a new one.",
        );
      }

      const number = await this.chapterNumber.next(String(params.campaignId));

      const campaign = await this.campaigns.getById(params.campaignId);
      const closesAt = this.computeClosesAt(campaign.chapterDuration);

      return await this.chapters.create({
        campaignId: params.campaignId,
        number,
        title: body.title || randomChapterName(),
        description: body.description ?? "",
        tags: body.tags ?? [],
        closesAt,
      });
    },
  });

  closeChapter = $action({
    use: [$secure({ permissions: ["quest:create"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        title: t.optional(t.string({ minLength: 1, maxLength: 100 })),
        tags: t.optional(t.array(t.string())),
      }),
      response: chapters.schema,
    },
    handler: async ({ params, body, user }) => {
      const chapter = await this.chapters.getById(params.id);
      await this.security.assertOwner(chapter.campaignId, user);

      if (chapter.closedAt) {
        throw new BadRequestError("Chapter is already closed.");
      }

      return await this.finalizeChapter(chapter, {
        title: body.title,
        tags: body.tags,
      });
    },
  });

  updateChapter = $action({
    use: [$secure({ permissions: ["quest:create"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      body: t.object({
        title: t.optional(t.string({ minLength: 1, maxLength: 100 })),
        description: t.optional(t.string({ size: "rich" })),
        tags: t.optional(t.array(t.string())),
      }),
      response: chapters.schema,
    },
    handler: async ({ params, body, user }) => {
      const chapter = await this.chapters.getById(params.id);
      await this.security.assertOwner(chapter.campaignId, user);

      return await this.chapters.updateById(params.id, {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        ...(body.tags !== undefined ? { tags: body.tags } : {}),
      });
    },
  });

  deleteChapter = $action({
    use: [$secure({ permissions: ["quest:delete"] })],
    schema: {
      params: t.object({
        id: t.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const chapter = await this.chapters.getById(params.id);
      await this.security.assertOwner(chapter.campaignId, user);

      const count = await this.countCompletedInWindow(chapter);
      if (count > 0) {
        throw new BadRequestError(
          "Cannot delete a chapter that recorded completed quests.",
        );
      }

      await this.chapters.deleteById(params.id);
      return { ok: true };
    },
  });

  getChapterChangelog = $action({
    use: [
      $secure({ permissions: ["quest:read"] }),
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
      await this.security.assertMember(chapter.campaignId, user);

      // Closed chapters return the frozen snapshot when available.
      if (chapter.closedAt && chapter.changelog) {
        const stats = await this.computeStats(chapter);
        return {
          markdown: chapter.changelog,
          chapter,
          stats,
        };
      }

      const completed = await this.queryCompletedInWindow(chapter);
      const { markdown, stats } = this.renderChangelog(chapter, completed);
      return { markdown, chapter, stats };
    },
  });

  getRandomChapterName = $action({
    use: [$secure({ permissions: ["quest:create"] })],
    schema: {
      response: t.object({ title: t.string() }),
    },
    handler: async () => ({ title: randomChapterName() }),
  });

  /**
   * Render the changelog markdown and persist it on the chapter row,
   * along with `closedAt` and any caller-supplied metadata. Shared by
   * the manual `closeChapter` action and the auto-close cron job.
   */
  async finalizeChapter(
    chapter: Chapter,
    overrides: { title?: string; tags?: string[] } = {},
  ): Promise<Chapter> {
    const completed = await this.queryCompletedInWindow({
      ...chapter,
      closedAt: chapter.closedAt ?? this.dt.nowISOString(),
    });
    const { markdown } = this.renderChangelog(
      {
        ...chapter,
        title: overrides.title ?? chapter.title,
        tags: overrides.tags ?? chapter.tags,
      },
      completed,
    );

    return await this.chapters.updateById(chapter.id, {
      closedAt: this.dt.nowISOString(),
      changelog: markdown,
      ...(overrides.title ? { title: overrides.title } : {}),
      ...(overrides.tags !== undefined ? { tags: overrides.tags } : {}),
    });
  }

  /**
   * Find all open chapters whose `closesAt` is in the past — used by the
   * auto-close cron.
   */
  async findExpiredChapters(now: string): Promise<Chapter[]> {
    return await this.chapters.findMany({
      where: {
        closedAt: { isNull: true },
        closesAt: { isNotNull: true, lte: now },
      },
    });
  }

  protected computeClosesAt(duration?: string): string | undefined {
    if (!duration) return undefined;
    const ms = parseIsoDurationMs(duration);
    if (ms == null || ms <= 0) return undefined;
    return new Date(this.dt.nowMillis() + ms).toISOString();
  }

  protected async queryCompletedInWindow(chapter: Chapter): Promise<Quest[]> {
    const upper = chapter.closedAt ?? this.dt.nowISOString();
    return await this.quests.findMany({
      where: {
        campaignId: { eq: chapter.campaignId },
        completedAt: {
          isNotNull: true,
          gte: chapter.createdAt,
          lte: upper,
        },
      },
    });
  }

  protected async countCompletedInWindow(chapter: Chapter): Promise<number> {
    const completed = await this.queryCompletedInWindow(chapter);
    return completed.length;
  }

  protected async computeStats(chapter: Chapter): Promise<{
    questCount: number;
    zoneCount: number;
    contributorCount: number;
  }> {
    const completed = await this.queryCompletedInWindow(chapter);
    const zones = new Set<string>();
    const contributors = new Set<string>();
    for (const q of completed) {
      zones.add(q.zone || "Uncategorized");
      if (q.completedBy) contributors.add(q.completedBy);
    }
    return {
      questCount: completed.length,
      zoneCount: zones.size,
      contributorCount: contributors.size,
    };
  }

  protected renderChangelog(
    chapter: Chapter,
    completed: Quest[],
  ): {
    markdown: string;
    stats: { questCount: number; zoneCount: number; contributorCount: number };
  } {
    const byZone = new Map<string, Quest[]>();
    for (const quest of completed) {
      const zone = quest.zone || "Uncategorized";
      if (!byZone.has(zone)) byZone.set(zone, []);
      byZone.get(zone)!.push(quest);
    }

    const contributors = new Set<string>();
    for (const quest of completed) {
      if (quest.completedBy) contributors.add(quest.completedBy);
    }

    const lines: string[] = [];
    lines.push(`# Chapter ${chapter.number}: ${chapter.title}`);
    lines.push("");

    if (chapter.tags?.length) {
      lines.push(`_Tags:_ ${chapter.tags.map((t) => `\`${t}\``).join(" ")}`);
      lines.push("");
    }

    if (chapter.description) {
      lines.push(chapter.description);
      lines.push("");
    }

    lines.push(
      `> ${completed.length} quest(s) completed across ${byZone.size} zone(s) by ${contributors.size} character(s)`,
    );
    lines.push("");

    for (const [zone, zoneQuests] of byZone) {
      lines.push(`## ${zone}`);
      lines.push("");
      for (const quest of zoneQuests) {
        const priority =
          quest.priority !== "optional" ? ` [${quest.priority}]` : "";
        lines.push(`- ${quest.title}${priority}`);
      }
      lines.push("");
    }

    return {
      markdown: lines.join("\n"),
      stats: {
        questCount: completed.length,
        zoneCount: byZone.size,
        contributorCount: contributors.size,
      },
    };
  }
}

/**
 * Parse a minimal subset of ISO 8601 duration strings (PnY, PnM, PnW, PnD,
 * PT…) into milliseconds. Returns `null` for unparseable input. Months and
 * years use approximate calendar lengths (30/365 days) — chapters don't
 * need calendar accuracy, only "roughly a month".
 */
function parseIsoDurationMs(iso: string): number | null {
  const match = iso.match(
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/,
  );
  if (!match) return null;
  const [, y, mo, w, d, h, mi, s] = match;
  const Y = 365 * 24 * 60 * 60 * 1000;
  const MO = 30 * 24 * 60 * 60 * 1000;
  const W = 7 * 24 * 60 * 60 * 1000;
  const D = 24 * 60 * 60 * 1000;
  const H = 60 * 60 * 1000;
  const MI = 60 * 1000;
  const S = 1000;
  let total = 0;
  if (y) total += Number(y) * Y;
  if (mo) total += Number(mo) * MO;
  if (w) total += Number(w) * W;
  if (d) total += Number(d) * D;
  if (h) total += Number(h) * H;
  if (mi) total += Number(mi) * MI;
  if (s) total += Number(s) * S;
  return total > 0 ? total : null;
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
