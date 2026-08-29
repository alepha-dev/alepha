import { $inject, z } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, $sequence, $transactional } from "alepha/orm";
import { OwnedResourceProvider, $secure } from "alepha/security";
import {
  $action,
  BadRequestError,
  ForbiddenError,
  okSchema,
} from "alepha/server";
import { $etag } from "alepha/server/etag";

import { type Milestone, milestones } from "../entities/milestones.ts";
import type { Project } from "../entities/projects.ts";
import { type Quest, quests } from "../entities/quests.ts";
import {
  type MilestoneChangelogArea,
  milestoneChangelogAreaSchema,
} from "../schemas/milestoneChangelogAreaSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { ProjectLimits } from "../services/ProjectLimits.ts";

export class MilestoneController {
  milestones = $repository(milestones);
  quests = $repository(quests);
  dt = $inject(DateTimeProvider);
  limits = $inject(ProjectLimits);
  crypto = $inject(CryptoProvider);
  owned = $inject(OwnedResourceProvider);

  /**
   * The four gates this controller needs, and the first place in the app
   * where both variants sit on one class.
   *
   * Member for reading a milestone or the backlog; owner for starting,
   * closing, editing and deleting one — a milestone is part of a project's
   * configuration, not of the work. `owner: true` drops the `via` join
   * rather than adding a second check, which is how `$owns` has always
   * expressed owner-only.
   *
   * Declared above the actions: `use: [this.ownsMilestone()]` is a field
   * initializer reading another field.
   */
  protected ownsProject = () => $ownsProject({ param: "projectId" });

  protected ownsProjectAsOwner = () =>
    $ownsProject({ param: "projectId", owner: true });

  protected ownsMilestone = () =>
    $ownsProject({ repository: () => this.milestones, param: "id" });

  protected ownsMilestoneAsOwner = () =>
    $ownsProject({
      repository: () => this.milestones,
      param: "id",
      owner: true,
    });

  /**
   * Name parts for the milestone-name generator. Two lists rather than one
   * table of finished names: 20 x 20 gives 400 combinations from 40 lines.
   */
  protected readonly NAME_PREFIXES = [
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

  protected readonly NAME_SUBJECTS = [
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

  /**
   * Parse a minimal subset of ISO 8601 duration strings (PnY, PnM, PnW, PnD,
   * PT...) into milliseconds. Returns `null` for unparseable input. Months and
   * years use approximate calendar lengths (30/365 days) - milestones don't
   * need calendar accuracy, only "roughly a month".
   */
  protected parseIsoDurationMs(iso: string): number | null {
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

  /**
   * A random flavour name for a milestone the author did not name.
   *
   * Drawn through `CryptoProvider.randomInt` rather than `Math.random()`, so
   * a test can substitute the provider and pin the name instead of asserting
   * "it looks like two words".
   */
  protected randomMilestoneName(): string {
    const prefix =
      this.NAME_PREFIXES[this.crypto.randomInt(this.NAME_PREFIXES.length)];
    const subject =
      this.NAME_SUBJECTS[this.crypto.randomInt(this.NAME_SUBJECTS.length)];
    return `${prefix} ${subject}`;
  }

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
      this.ownsProject(),
      // `noCache` rather than a `maxAge` window: this list changes the
      // instant someone starts, closes or deletes a milestone, and a
      // freshness window made those mutations invisible to the browser for
      // its whole duration — start a milestone and the page kept showing
      // "nothing is recording" until the entry expired. `no-cache` still
      // lets the ETag answer 304, so revalidation stays cheap; it only
      // forbids serving the body without asking.
      $etag({ control: { private: true, noCache: true } }),
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
    handler: async ({ params }) => {
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
    // Gate ahead of `$transactional()`: a refused caller never opens one.
    use: [
      $secure({ permissions: ["quest:create"] }),
      this.ownsProjectAsOwner(),
      $transactional(),
    ],
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
    handler: async ({ params, body }) => {
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

      // Closed milestones count too: the cap bounds the table, and the
      // one-active rule above already bounds what is open.
      const maxMilestonesPerProject =
        await this.limits.maxMilestonesPerProject();
      const milestoneCount = await this.milestones.count({
        projectId: { eq: params.projectId },
      });
      if (milestoneCount >= maxMilestonesPerProject) {
        throw new ForbiddenError(
          `This project has reached the maximum number of milestones allowed (${maxMilestonesPerProject}).`,
        );
      }

      // After the caps, so a refused start does not burn a number.
      const number = await this.milestoneNumber.next(String(params.projectId));

      // The gate already read this row; `authority()` hands it back rather
      // than issuing the same query a second time.
      const project = this.owned.authority<Project>();
      const closesAt = this.computeClosesAt(project.milestoneDuration);

      return await this.milestones.create({
        projectId: params.projectId,
        number,
        title: body.title || this.randomMilestoneName(),
        description: body.description ?? "",
        tags: body.tags ?? [],
        closesAt,
      });
    },
  });

  closeMilestone = $action({
    use: [
      $secure({ permissions: ["quest:create"] }),
      this.ownsMilestoneAsOwner(),
    ],
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
    handler: async ({ body }) => {
      const milestone = this.owned.get<Milestone>();

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
    use: [
      $secure({ permissions: ["quest:create"] }),
      this.ownsMilestoneAsOwner(),
    ],
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
    handler: async ({ params, body }) => {
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
    use: [
      $secure({ permissions: ["quest:delete"] }),
      this.ownsMilestoneAsOwner(),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      const milestone = this.owned.get<Milestone>();

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
      this.ownsMilestone(),
      // Same reasoning as `getMilestones`: an open milestone's changelog is
      // recomputed from completed quests, so a freshness window hides work
      // that just landed. ETag-only revalidation keeps it cheap.
      $etag({ control: { private: true, noCache: true } }),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: z.object({
        markdown: z.string(),
        milestone: milestones.schema,
        /**
         * The same entries the markdown lists, in structured form, so the
         * page can render `#ref · title · priority` rows. See
         * `milestoneChangelogAreaSchema` for why both projections ship.
         */
        areas: z.array(milestoneChangelogAreaSchema),
        stats: z.object({
          questCount: z.integer(),
          areaCount: z.integer(),
          contributorCount: z.integer(),
        }),
      }),
    },
    handler: async () => {
      const milestone = this.owned.get<Milestone>();

      const completed = await this.queryCompletedInWindow(milestone);
      const { areas, stats } = this.summarize(completed);

      // Closed milestones return the frozen markdown snapshot when there is
      // one; `areas` is recomputed either way, so a post-close quest edit
      // shows up in the rows but not in the downloadable `.md`.
      if (milestone.closedAt && milestone.changelog) {
        return { markdown: milestone.changelog, milestone, areas, stats };
      }

      const { markdown } = this.renderChangelog(milestone, completed);
      return { markdown, milestone, areas, stats };
    },
  });

  /**
   * How many quests have been completed since the last milestone closed —
   * work that is landing in no changelog at all because nothing is
   * recording. Drives the "nothing is recording" banner, which needs to say
   * what that costs rather than just that it is true.
   *
   * Counts from the whole project when no milestone has ever closed, and
   * returns 0 while a milestone is open (that work is being recorded).
   */
  getMilestoneBacklog = $action({
    use: [$secure({ permissions: ["quest:read"] }), this.ownsProject()],
    schema: {
      params: z.object({
        projectId: z.integer(),
      }),
      response: z.object({
        count: z.integer(),
        /**
         * `closedAt` of the last closed milestone, when there is one.
         */
        since: z.datetime().optional(),
        lastNumber: z.integer().optional(),
        lastTitle: z.string().optional(),
      }),
    },
    handler: async ({ params }) => {
      const open = await this.milestones.findMany({
        where: {
          projectId: { eq: params.projectId },
          closedAt: { isNull: true },
        },
        limit: 1,
      });

      const [last] = await this.milestones.findMany({
        where: {
          projectId: { eq: params.projectId },
          closedAt: { isNotNull: true },
        },
        orderBy: [{ column: "closedAt", direction: "desc" }],
        limit: 1,
      });

      // A milestone is recording — nothing is falling through the cracks.
      if (open.length > 0) {
        return {
          count: 0,
          ...(last?.closedAt ? { since: last.closedAt } : {}),
          ...(last ? { lastNumber: last.number, lastTitle: last.title } : {}),
        };
      }

      const count = await this.quests.count({
        projectId: { eq: params.projectId },
        completedAt: last?.closedAt
          ? { isNotNull: true, gt: last.closedAt }
          : { isNotNull: true },
      });

      return {
        count,
        ...(last?.closedAt ? { since: last.closedAt } : {}),
        ...(last ? { lastNumber: last.number, lastTitle: last.title } : {}),
      };
    },
  });

  /**
   * Deliberately ungated beyond the permission: it reads no project data and
   * touches no row, so there is no resource for `$ownsProject` to name.
   */
  getRandomMilestoneName = $action({
    use: [$secure({ permissions: ["quest:create"] })],
    schema: {
      response: z.object({ title: z.string() }),
    },
    handler: async () => ({ title: this.randomMilestoneName() }),
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
    const ms = this.parseIsoDurationMs(duration);
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

  /**
   * Group completed quests by area, preserving insertion order so the
   * structured areas and the rendered markdown list them identically.
   */
  protected groupByArea(completed: Quest[]): Map<string, Quest[]> {
    const byArea = new Map<string, Quest[]>();
    for (const quest of completed) {
      const area = quest.area || "Uncategorized";
      if (!byArea.has(area)) byArea.set(area, []);
      byArea.get(area)!.push(quest);
    }
    return byArea;
  }

  /**
   * The structured projection of a changelog: area groups plus the headline
   * counters. Shares `groupByArea` with `renderChangelog`, so the rows the
   * page draws and the markdown it can download never disagree on grouping.
   */
  protected summarize(completed: Quest[]): {
    areas: MilestoneChangelogArea[];
    stats: { questCount: number; areaCount: number; contributorCount: number };
  } {
    const byArea = this.groupByArea(completed);

    const contributors = new Set<string>();
    for (const quest of completed) {
      if (quest.completedBy) contributors.add(quest.completedBy);
    }

    const areas: MilestoneChangelogArea[] = [...byArea].map(
      ([name, areaQuests]) => ({
        name,
        questCount: areaQuests.length,
        quests: areaQuests.map((quest) => ({
          shortId: quest.shortId,
          title: quest.title,
          priority: quest.priority,
        })),
      }),
    );

    return {
      areas,
      stats: {
        questCount: completed.length,
        areaCount: byArea.size,
        contributorCount: contributors.size,
      },
    };
  }

  protected renderChangelog(
    milestone: Milestone,
    completed: Quest[],
  ): {
    markdown: string;
    stats: { questCount: number; areaCount: number; contributorCount: number };
  } {
    const byArea = this.groupByArea(completed);

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
      `> ${completed.length} quest(s) completed across ${byArea.size} area(s) by ${contributors.size} member(s)`,
    );
    lines.push("");

    for (const [area, areaQuests] of byArea) {
      lines.push(`## ${area}`);
      lines.push("");
      for (const quest of areaQuests) {
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
        areaCount: byArea.size,
        contributorCount: contributors.size,
      },
    };
  }
}
