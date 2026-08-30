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

import type { Project } from "../entities/projects.ts";
import { type Quest, quests } from "../entities/quests.ts";
import { type Release, releases } from "../entities/releases.ts";
import {
  type ReleaseChangelogArea,
  releaseChangelogAreaSchema,
} from "../schemas/releaseChangelogAreaSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { ProjectLimits } from "../services/ProjectLimits.ts";

export class ReleaseController {
  releases = $repository(releases);
  quests = $repository(quests);
  dt = $inject(DateTimeProvider);
  limits = $inject(ProjectLimits);
  crypto = $inject(CryptoProvider);
  owned = $inject(OwnedResourceProvider);

  /**
   * The four gates this controller needs, and the first place in the app
   * where both variants sit on one class.
   *
   * Member for reading a release or the backlog; owner for starting,
   * closing, editing and deleting one - a release is part of a project's
   * configuration, not of the work. `owner: true` drops the `via` join
   * rather than adding a second check, which is how `$owns` has always
   * expressed owner-only.
   *
   * Declared above the actions: `use: [this.ownsRelease()]` is a field
   * initializer reading another field.
   */
  protected ownsProject = () => $ownsProject({ param: "projectId" });

  protected ownsProjectAsOwner = () =>
    $ownsProject({ param: "projectId", owner: true });

  protected ownsRelease = () =>
    $ownsProject({ repository: () => this.releases, param: "id" });

  protected ownsReleaseAsOwner = () =>
    $ownsProject({
      repository: () => this.releases,
      param: "id",
      owner: true,
    });

  /**
   * Name parts for the release-name generator. Two lists rather than one
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
   * years use approximate calendar lengths (30/365 days) - releases don't
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
   * A random flavour name for a release the author did not name.
   *
   * Drawn through `CryptoProvider.randomInt` rather than `Math.random()`, so
   * a test can substitute the provider and pin the name instead of asserting
   * "it looks like two words".
   */
  protected randomReleaseName(): string {
    const prefix =
      this.NAME_PREFIXES[this.crypto.randomInt(this.NAME_PREFIXES.length)];
    const subject =
      this.NAME_SUBJECTS[this.crypto.randomInt(this.NAME_SUBJECTS.length)];
    return `${prefix} ${subject}`;
  }

  /**
   * Per-project sequence for `releases.number`. Replaces the old MAX+1
   * lookup with an atomic counter — race-safe even under concurrent starts.
   *
   * `$sequence` keys its counter on the property name, not the table, so a
   * rename orphans the old counter row and restarts at 1. `chapterNumber`
   * became `milestoneNumber` in the 2026-08 great rename and needed an
   * `UPDATE alepha_sequences` to carry the history across.
   *
   * This rename needed no such UPDATE: the Lore Release migration deletes
   * every milestone row, so there is no history to collide with and
   * `releaseNumber` starting at 1 is the correct answer. The migration
   * `DELETE`s the orphan `milestoneNumber` row rather than repointing it.
   * A future rename of this property is back under the old rule.
   */
  protected releaseNumber = $sequence();

  getReleases = $action({
    use: [
      $secure({ permissions: ["quest:read"] }),
      this.ownsProject(),
      // `noCache` rather than a `maxAge` window: this list changes the
      // instant someone starts, closes or deletes a release, and a
      // freshness window made those mutations invisible to the browser for
      // its whole duration — start a release and the page kept showing
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
        releases.schema.extend({
          questCount: z.integer(),
        }),
      ),
    },
    handler: async ({ params }) => {
      const allReleases = await this.releases.findMany({
        where: {
          projectId: { eq: params.projectId },
        },
        orderBy: [{ column: "number", direction: "desc" }],
      });

      const counts = await Promise.all(
        allReleases.map((ch) => this.countCompletedInWindow(ch)),
      );

      return allReleases.map((ch, i) => ({
        ...ch,
        questCount: counts[i],
      }));
    },
  });

  startRelease = $action({
    // Gate INSIDE the transaction, not ahead of it - see `$ownsProject`.
    use: [
      $secure({ permissions: ["quest:create"] }),
      $transactional(),
      this.ownsProjectAsOwner(),
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
      response: releases.schema,
    },
    handler: async ({ params, body }) => {
      const active = await this.releases.findMany({
        where: {
          projectId: { eq: params.projectId },
          closedAt: { isNull: true },
        },
      });

      if (active.length > 0) {
        throw new BadRequestError(
          "An active release already exists. Close it before starting a new one.",
        );
      }

      // Closed releases count too: the cap bounds the table, and the
      // one-active rule above already bounds what is open.
      const maxReleasesPerProject = await this.limits.maxReleasesPerProject();
      const releaseCount = await this.releases.count({
        projectId: { eq: params.projectId },
      });
      if (releaseCount >= maxReleasesPerProject) {
        throw new ForbiddenError(
          `This project has reached the maximum number of releases allowed (${maxReleasesPerProject}).`,
        );
      }

      // After the caps, so a refused start does not burn a number.
      const number = await this.releaseNumber.next(String(params.projectId));

      // The gate already read this row; `authority()` hands it back rather
      // than issuing the same query a second time.
      const project = this.owned.authority<Project>();
      const closesAt = this.computeClosesAt(project.milestoneDuration);

      return await this.releases.create({
        projectId: params.projectId,
        number,
        title: body.title || this.randomReleaseName(),
        description: body.description ?? "",
        tags: body.tags ?? [],
        closesAt,
      });
    },
  });

  closeRelease = $action({
    use: [
      $secure({ permissions: ["quest:create"] }),
      this.ownsReleaseAsOwner(),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      body: z.object({
        title: z.string().min(1).max(100).optional(),
        tags: z.array(z.string()).optional(),
      }),
      response: releases.schema,
    },
    handler: async ({ body }) => {
      const release = this.owned.get<Release>();

      if (release.closedAt) {
        throw new BadRequestError("Release is already closed.");
      }

      return await this.finalizeRelease(release, {
        title: body.title,
        tags: body.tags,
      });
    },
  });

  updateRelease = $action({
    use: [
      $secure({ permissions: ["quest:create"] }),
      this.ownsReleaseAsOwner(),
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
      response: releases.schema,
    },
    handler: async ({ params, body }) => {
      return await this.releases.updateById(params.id, {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        ...(body.tags !== undefined ? { tags: body.tags } : {}),
      });
    },
  });

  deleteRelease = $action({
    use: [
      $secure({ permissions: ["quest:delete"] }),
      this.ownsReleaseAsOwner(),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: okSchema,
    },
    handler: async ({ params }) => {
      const release = this.owned.get<Release>();

      const count = await this.countCompletedInWindow(release);
      if (count > 0) {
        throw new BadRequestError(
          "Cannot delete a release that recorded completed quests.",
        );
      }

      await this.releases.deleteById(params.id);
      return { ok: true };
    },
  });

  getReleaseChangelog = $action({
    use: [
      $secure({ permissions: ["quest:read"] }),
      this.ownsRelease(),
      // Same reasoning as `getReleases`: an open release's changelog is
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
        release: releases.schema,
        /**
         * The same entries the markdown lists, in structured form, so the
         * page can render `#ref · title · priority` rows. See
         * `releaseChangelogAreaSchema` for why both projections ship.
         */
        areas: z.array(releaseChangelogAreaSchema),
        stats: z.object({
          questCount: z.integer(),
          areaCount: z.integer(),
          contributorCount: z.integer(),
        }),
      }),
    },
    handler: async () => {
      const release = this.owned.get<Release>();

      const completed = await this.queryCompletedInWindow(release);
      const { areas, stats } = this.summarize(completed);

      // Closed releases return the frozen markdown snapshot when there is
      // one; `areas` is recomputed either way, so a post-close quest edit
      // shows up in the rows but not in the downloadable `.md`.
      if (release.closedAt && release.changelog) {
        return { markdown: release.changelog, release, areas, stats };
      }

      const { markdown } = this.renderChangelog(release, completed);
      return { markdown, release, areas, stats };
    },
  });

  /**
   * How many quests have been completed since the last release closed —
   * work that is landing in no changelog at all because nothing is
   * recording. Drives the "nothing is recording" banner, which needs to say
   * what that costs rather than just that it is true.
   *
   * Counts from the whole project when no release has ever closed, and
   * returns 0 while a release is open (that work is being recorded).
   */
  getReleaseBacklog = $action({
    use: [$secure({ permissions: ["quest:read"] }), this.ownsProject()],
    schema: {
      params: z.object({
        projectId: z.integer(),
      }),
      response: z.object({
        count: z.integer(),
        /**
         * `closedAt` of the last closed release, when there is one.
         */
        since: z.datetime().optional(),
        lastNumber: z.integer().optional(),
        lastTitle: z.string().optional(),
      }),
    },
    handler: async ({ params }) => {
      const open = await this.releases.findMany({
        where: {
          projectId: { eq: params.projectId },
          closedAt: { isNull: true },
        },
        limit: 1,
      });

      const [last] = await this.releases.findMany({
        where: {
          projectId: { eq: params.projectId },
          closedAt: { isNotNull: true },
        },
        orderBy: [{ column: "closedAt", direction: "desc" }],
        limit: 1,
      });

      // A release is recording — nothing is falling through the cracks.
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
  getRandomReleaseName = $action({
    use: [$secure({ permissions: ["quest:create"] })],
    schema: {
      response: z.object({ title: z.string() }),
    },
    handler: async () => ({ title: this.randomReleaseName() }),
  });

  /**
   * Render the changelog markdown and persist it on the release row,
   * along with `closedAt` and any caller-supplied metadata. Shared by
   * the manual `closeRelease` action and the auto-close cron job.
   */
  async finalizeRelease(
    release: Release,
    overrides: { title?: string; tags?: string[] } = {},
  ): Promise<Release> {
    const completed = await this.queryCompletedInWindow({
      ...release,
      closedAt: release.closedAt ?? this.dt.nowISOString(),
    });
    const { markdown } = this.renderChangelog(
      {
        ...release,
        title: overrides.title ?? release.title,
        tags: overrides.tags ?? release.tags,
      },
      completed,
    );

    return await this.releases.updateById(release.id, {
      closedAt: this.dt.nowISOString(),
      changelog: markdown,
      ...(overrides.title ? { title: overrides.title } : {}),
      ...(overrides.tags !== undefined ? { tags: overrides.tags } : {}),
    });
  }

  /**
   * Find all open releases whose `closesAt` is in the past — used by the
   * auto-close cron.
   */
  async findExpiredReleases(now: string): Promise<Release[]> {
    return await this.releases.findMany({
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

  protected async queryCompletedInWindow(release: Release): Promise<Quest[]> {
    const upper = release.closedAt ?? this.dt.nowISOString();
    return await this.quests.findMany({
      where: {
        projectId: { eq: release.projectId },
        completedAt: {
          isNotNull: true,
          gte: release.createdAt,
          lte: upper,
        },
      },
    });
  }

  protected async countCompletedInWindow(release: Release): Promise<number> {
    const completed = await this.queryCompletedInWindow(release);
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
    areas: ReleaseChangelogArea[];
    stats: { questCount: number; areaCount: number; contributorCount: number };
  } {
    const byArea = this.groupByArea(completed);

    const contributors = new Set<string>();
    for (const quest of completed) {
      if (quest.completedBy) contributors.add(quest.completedBy);
    }

    const areas: ReleaseChangelogArea[] = [...byArea].map(
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
    release: Release,
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
    lines.push(`# Release ${release.number}: ${release.title}`);
    lines.push("");

    if (release.tags?.length) {
      lines.push(`_Tags:_ ${release.tags.map((t) => `\`${t}\``).join(" ")}`);
      lines.push("");
    }

    if (release.description) {
      lines.push(release.description);
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
