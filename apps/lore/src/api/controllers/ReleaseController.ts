import { $inject, z } from "alepha";
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
  owned = $inject(OwnedResourceProvider);

  /**
   * The four gates this controller needs, and the first place in the app
   * where both variants sit on one class.
   *
   * Member for reading a release; owner for creating, closing, editing and
   * deleting one - a release is part of a project's configuration, not of the
   * work. `owner: true` drops the `via` join rather than adding a second
   * check, which is how `$owns` has always expressed owner-only.
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
   * Per-project sequence for `releases.number`. Replaces the old MAX+1
   * lookup with an atomic counter — race-safe even under concurrent creates.
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
      // instant someone creates, closes or deletes a release, and a
      // freshness window made those mutations invisible to the browser for
      // its whole duration. `no-cache` still lets the ETag answer 304, so
      // revalidation stays cheap; it only forbids serving the body without
      // asking.
      $etag({ control: { private: true, noCache: true } }),
    ],
    schema: {
      params: z.object({
        projectId: z.integer(),
      }),
      response: z.array(releases.schema),
    },
    handler: async ({ params }) => {
      return await this.releases.findMany({
        where: {
          projectId: { eq: params.projectId },
        },
        orderBy: [{ column: "number", direction: "desc" }],
      });
    },
  });

  createRelease = $action({
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
        /**
         * Required, unlike the release it replaced. The fantasy-name
         * generator that filled this in is gone: a release is called
         * `0.28.0`, and no generator can guess that.
         */
        title: z.string().min(1).max(100),
        description: z.string().meta({ size: "rich" }).optional(),
        tags: z.array(z.string()).optional(),
      }),
      response: releases.schema,
    },
    handler: async ({ params, body }) => {
      // There is deliberately no "one open at a time" guard: `0.28.0`,
      // `1.0.0` and `1.1.0` are meant to coexist, and a hotfix is a new
      // release beside the one it patches rather than a state on it.
      //
      // That makes this cap the ONLY thing bounding the table, so it matters
      // more than it did, not less.
      const maxReleasesPerProject = await this.limits.maxReleasesPerProject();
      const releaseCount = await this.releases.count({
        projectId: { eq: params.projectId },
      });
      if (releaseCount >= maxReleasesPerProject) {
        throw new ForbiddenError(
          `This project has reached the maximum number of releases allowed (${maxReleasesPerProject}).`,
        );
      }

      // After the cap, so a refused create does not burn a number.
      const number = await this.releaseNumber.next(String(params.projectId));

      return await this.releases.create({
        projectId: params.projectId,
        number,
        title: body.title,
        description: body.description ?? "",
        tags: body.tags ?? [],
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
      // Deleting is deliberately cheap. The old guard refused whenever the
      // release's time window had caught any completed quest, which meant a
      // mistyped release locked itself the moment anything completed anywhere
      // in the project. Membership is an assignment now and
      // `quests.releaseId` is `ON DELETE SET NULL`, so nothing is lost here
      // but the row itself.
      await this.releases.deleteById(params.id);
      return { ok: true };
    },
  });

  getReleaseChangelog = $action({
    use: [
      $secure({ permissions: ["quest:read"] }),
      this.ownsRelease(),
      // Same reasoning as `getReleases`: an open release's changelog is
      // recomputed from its completed quests, so a freshness window hides
      // work that just landed. ETag-only revalidation keeps it cheap.
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

      const completed = await this.queryCompleted(release);
      const { areas, stats } = this.summarize(completed);

      // Closed releases return the frozen markdown snapshot when there is
      // one; `areas` is recomputed either way.
      if (release.closedAt && release.changelog) {
        return { markdown: release.changelog, release, areas, stats };
      }

      const { markdown } = this.renderChangelog(release, completed);
      return { markdown, release, areas, stats };
    },
  });

  /**
   * Render the changelog markdown and persist it on the release row, along
   * with `closedAt` and any caller-supplied metadata.
   */
  async finalizeRelease(
    release: Release,
    overrides: { title?: string; tags?: string[] } = {},
  ): Promise<Release> {
    const completed = await this.queryCompleted(release);
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
   * The completed quests attached to a release.
   *
   * This replaced `queryCompletedInWindow`, which asked
   * `completedAt BETWEEN release.createdAt AND (closedAt ?? now)` — a time
   * window, i.e. `git log --since --until` grouped by area. Membership is an
   * assignment now, so the question is which quests were put in the release,
   * not which happened to finish while it was open.
   */
  protected async queryCompleted(release: Release): Promise<Quest[]> {
    return await this.quests.findMany({
      where: {
        projectId: { eq: release.projectId },
        releaseId: { eq: release.id },
        completedAt: { isNotNull: true },
      },
    });
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
