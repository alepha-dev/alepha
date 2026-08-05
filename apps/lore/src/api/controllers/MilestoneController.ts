import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository, $sequence, $transactional } from "alepha/orm";
import { $secure } from "alepha/security";
import { $action, BadRequestError, okSchema } from "alepha/server";
import { $etag } from "alepha/server/etag";
import { type Milestone, milestones } from "../entities/milestones.ts";
import { projects } from "../entities/projects.ts";
import { type Quest, quests } from "../entities/quests.ts";
import { ProjectSecurityService } from "../services/ProjectSecurityService.ts";

export class MilestoneController {
  log = $logger();
  milestones = $repository(milestones);
  quests = $repository(quests);
  projects = $repository(projects);
  dt = $inject(DateTimeProvider);
  security = $inject(ProjectSecurityService);

  /**
   * Per-project sequence for `milestones.number`. Replaces the old MAX+1
   * lookup with an atomic counter — race-safe even under concurrent starts.
   *
   * Renamed from `chapterNumber` in the 2026-08 great rename. `$sequence`
   * keys its counter on the property name, so the migration carries an
   * `UPDATE alepha_sequences SET name = 'milestoneNumber' WHERE name =
   * 'chapterNumber'` — without it every existing project restarts at 1 and
   * collides with its own history. Renaming this property again needs the
   * same treatment.
   */
  protected milestoneNumber = $sequence();

  getMilestones = $action({
    use: [
      $secure({ permissions: ["quest:read"] }),
      $etag({
        control: { private: true, maxAge: 30, staleWhileRevalidate: 120 },
      }),
    ],
    schema: {
      params: z.object({
        projectId: z.integer(),
      }),
      response: z.array(
        milestones.schema.extend({
          questCount: z.integer(),
        }),
      ),
    },
    handler: async ({ params, user }) => {
      await this.security.assertMember(params.projectId, user);

      const allMilestones = await this.milestones.findMany({
        where: {
          projectId: { eq: params.projectId },
        },
        orderBy: [{ column: "number", direction: "desc" }],
      });

      const counts = await Promise.all(
        allMilestones.map((ch) => this.countCompletedInWindow(ch)),
      );

      return allMilestones.map((ch, i) => ({
        ...ch,
        questCount: counts[i],
      }));
    },
  });

  startMilestone = $action({
    use: [$secure({ permissions: ["quest:create"] }), $transactional()],
    schema: {
      params: z.object({
        projectId: z.integer(),
      }),
      body: z.object({
        title: z.string().min(1).max(100).optional(),
        description: z.string().meta({ size: "rich" }).optional(),
        tags: z.array(z.string()).optional(),
      }),
      response: milestones.schema,
    },
    handler: async ({ params, body, user }) => {
      await this.security.assertOwner(params.projectId, user);

      const active = await this.milestones.findMany({
        where: {
          projectId: { eq: params.projectId },
          closedAt: { isNull: true },
        },
      });

      if (active.length > 0) {
        throw new BadRequestError(
          "An active milestone already exists. Close it before starting a new one.",
        );
      }

      const number = await this.milestoneNumber.next(String(params.projectId));

      const project = await this.projects.getById(params.projectId);
      const closesAt = this.computeClosesAt(project.milestoneDuration);

      return await this.milestones.create({
        projectId: params.projectId,
        number,
        title: body.title || randomMilestoneName(),
        description: body.description ?? "",
        tags: body.tags ?? [],
        closesAt,
      });
    },
  });

  closeMilestone = $action({
    use: [$secure({ permissions: ["quest:create"] })],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      body: z.object({
        title: z.string().min(1).max(100).optional(),
        tags: z.array(z.string()).optional(),
      }),
      response: milestones.schema,
    },
    handler: async ({ params, body, user }) => {
      const milestone = await this.milestones.getById(params.id);
      await this.security.assertOwner(milestone.projectId, user);

      if (milestone.closedAt) {
        throw new BadRequestError("Milestone is already closed.");
      }

      return await this.finalizeMilestone(milestone, {
        title: body.title,
        tags: body.tags,
      });
    },
  });

  updateMilestone = $action({
    use: [$secure({ permissions: ["quest:create"] })],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      body: z.object({
        title: z.string().min(1).max(100).optional(),
        description: z.string().meta({ size: "rich" }).optional(),
        tags: z.array(z.string()).optional(),
      }),
      response: milestones.schema,
    },
    handler: async ({ params, body, user }) => {
      const milestone = await this.milestones.getById(params.id);
      await this.security.assertOwner(milestone.projectId, user);

      return await this.milestones.updateById(params.id, {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        ...(body.tags !== undefined ? { tags: body.tags } : {}),
      });
    },
  });

  deleteMilestone = $action({
    use: [$secure({ permissions: ["quest:delete"] })],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params, user }) => {
      const milestone = await this.milestones.getById(params.id);
      await this.security.assertOwner(milestone.projectId, user);

      const count = await this.countCompletedInWindow(milestone);
      if (count > 0) {
        throw new BadRequestError(
          "Cannot delete a milestone that recorded completed quests.",
        );
      }

      await this.milestones.deleteById(params.id);
      return { ok: true };
    },
  });

  getMilestoneChangelog = $action({
    use: [
      $secure({ permissions: ["quest:read"] }),
      $etag({
        control: { private: true, maxAge: 60, staleWhileRevalidate: 600 },
      }),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: z.object({
        markdown: z.string(),
        milestone: milestones.schema,
        stats: z.object({
          questCount: z.integer(),
          zoneCount: z.integer(),
          contributorCount: z.integer(),
        }),
      }),
    },
    handler: async ({ params, user }) => {
      const milestone = await this.milestones.getById(params.id);
      await this.security.assertMember(milestone.projectId, user);

      // Closed milestones return the frozen snapshot when available.
      if (milestone.closedAt && milestone.changelog) {
        const stats = await this.computeStats(milestone);
        return {
          markdown: milestone.changelog,
          milestone,
          stats,
        };
      }

      const completed = await this.queryCompletedInWindow(milestone);
      const { markdown, stats } = this.renderChangelog(milestone, completed);
      return { markdown, milestone, stats };
    },
  });

  getRandomMilestoneName = $action({
    use: [$secure({ permissions: ["quest:create"] })],
    schema: {
      response: z.object({ title: z.string() }),
    },
    handler: async () => ({ title: randomMilestoneName() }),
  });

  /**
   * Render the changelog markdown and persist it on the milestone row,
   * along with `closedAt` and any caller-supplied metadata. Shared by
   * the manual `closeMilestone` action and the auto-close cron job.
   */
  async finalizeMilestone(
    milestone: Milestone,
    overrides: { title?: string; tags?: string[] } = {},
  ): Promise<Milestone> {
    const completed = await this.queryCompletedInWindow({
      ...milestone,
      closedAt: milestone.closedAt ?? this.dt.nowISOString(),
    });
    const { markdown } = this.renderChangelog(
      {
        ...milestone,
        title: overrides.title ?? milestone.title,
        tags: overrides.tags ?? milestone.tags,
      },
      completed,
    );

    return await this.milestones.updateById(milestone.id, {
      closedAt: this.dt.nowISOString(),
      changelog: markdown,
      ...(overrides.title ? { title: overrides.title } : {}),
      ...(overrides.tags !== undefined ? { tags: overrides.tags } : {}),
    });
  }

  /**
   * Find all open milestones whose `closesAt` is in the past — used by the
   * auto-close cron.
   */
  async findExpiredMilestones(now: string): Promise<Milestone[]> {
    return await this.milestones.findMany({
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

  protected async queryCompletedInWindow(
    milestone: Milestone,
  ): Promise<Quest[]> {
    const upper = milestone.closedAt ?? this.dt.nowISOString();
    return await this.quests.findMany({
      where: {
        projectId: { eq: milestone.projectId },
        completedAt: {
          isNotNull: true,
          gte: milestone.createdAt,
          lte: upper,
        },
      },
    });
  }

  protected async countCompletedInWindow(
    milestone: Milestone,
  ): Promise<number> {
    const completed = await this.queryCompletedInWindow(milestone);
    return completed.length;
  }

  protected async computeStats(milestone: Milestone): Promise<{
    questCount: number;
    zoneCount: number;
    contributorCount: number;
  }> {
    const completed = await this.queryCompletedInWindow(milestone);
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
    milestone: Milestone,
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
    lines.push(`# Milestone ${milestone.number}: ${milestone.title}`);
    lines.push("");

    if (milestone.tags?.length) {
      lines.push(`_Tags:_ ${milestone.tags.map((t) => `\`${t}\``).join(" ")}`);
      lines.push("");
    }

    if (milestone.description) {
      lines.push(milestone.description);
      lines.push("");
    }

    lines.push(
      `> ${completed.length} quest(s) completed across ${byZone.size} zone(s) by ${contributors.size} member(s)`,
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
 * years use approximate calendar lengths (30/365 days) — milestones don't
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

function randomMilestoneName(): string {
  const prefix = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
  const subject = SUBJECTS[Math.floor(Math.random() * SUBJECTS.length)];
  return `${prefix} ${subject}`;
}
