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
import {
  RELEASE_TAG_PATTERN,
  releaseTagSchema,
} from "../schemas/releaseTagSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { ProjectLimits } from "../services/ProjectLimits.ts";
import { ReleaseContentService } from "../services/ReleaseContentService.ts";

export class ReleaseController {
  releases = $repository(releases);
  quests = $repository(quests);
  dt = $inject(DateTimeProvider);
  limits = $inject(ProjectLimits);
  contents = $inject(ReleaseContentService);
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
         * The release's identity. Required: the fantasy-name generator that
         * used to fill a title in is gone, and a release is called `0.28.0`.
         */
        tag: releaseTagSchema,
        /**
         * Optional, and defaults to the tag server-side. Kept `NOT NULL` on
         * the column: dropping a `NOT NULL` is not something SQLite's
         * `ALTER TABLE` can do, so making it nullable would force a table
         * rebuild. The rendered result is identical.
         */
        title: z.string().min(1).max(100).optional(),
        description: z.string().meta({ size: "rich" }).optional(),
        targetDate: z.datetime().optional(),
      }),
      response: releases.schema,
    },
    handler: async ({ params, body }) => {
      const tag = this.assertTag(body.tag);

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
        tag,
        title: body.title ?? tag,
        description: body.description ?? "",
        ...(body.targetDate ? { targetDate: body.targetDate } : {}),
      });
    },
  });

  /**
   * Publish a release. A ONE-WAY door.
   *
   * It does not merely stamp `releasedAt`: it freezes the changelog AND the
   * four progress counts onto the row, and `updateRelease` / attach / detach
   * all refuse afterwards. A released release then renders entirely from its
   * own row with no live query at all. Without that, completing a quest a
   * month after `0.28.0` shipped would silently rewrite what `0.28.0`
   * shipped, which is exactly the dishonesty the frozen changelog exists to
   * prevent.
   */
  publishRelease = $action({
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
      }),
      response: releases.schema,
    },
    handler: async ({ body }) => {
      const release = this.owned.get<Release>();
      this.assertOpen(release);

      const withTitle = body.title
        ? { ...release, title: body.title }
        : release;
      const completed = await this.queryCompleted(release);
      const { markdown } = this.renderChangelog(withTitle, completed);
      const progress = await this.computeProgress(release);

      return await this.releases.updateById(release.id, {
        releasedAt: this.dt.nowISOString(),
        changelog: markdown,
        ...progress,
        ...(body.title ? { title: body.title } : {}),
      });
    },
  });

  /**
   * The only way back from published, and the reason publishing can be a
   * one-way door without being a trap: "published by mistake" is real, and
   * delete-and-recreate would burn the number and lose the tag.
   *
   * Clears everything publishing froze, so the release goes back to being
   * computed live rather than keeping a snapshot nothing agrees with.
   */
  reopenRelease = $action({
    use: [
      $secure({ permissions: ["quest:create"] }),
      this.ownsReleaseAsOwner(),
    ],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: releases.schema,
    },
    handler: async ({ params }) => {
      const release = this.owned.get<Release>();

      if (!release.releasedAt) {
        throw new BadRequestError("Release is already open.");
      }

      return await this.releases.updateById(params.id, {
        releasedAt: null,
        changelog: null,
        completed: null,
        inProgress: null,
        shelved: null,
        total: null,
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
        tag: releaseTagSchema.optional(),
        title: z.string().min(1).max(100).optional(),
        description: z.string().meta({ size: "rich" }).optional(),
        targetDate: z.datetime().nullable().optional(),
      }),
      response: releases.schema,
    },
    handler: async ({ params, body }) => {
      this.assertOpen(this.owned.get<Release>());

      return await this.releases.updateById(params.id, {
        ...(body.tag !== undefined ? { tag: this.assertTag(body.tag) } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        ...(body.targetDate !== undefined
          ? { targetDate: body.targetDate ?? null }
          : {}),
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

      // A released release returns the frozen markdown snapshot; `areas` is
      // recomputed either way.
      if (release.releasedAt && release.changelog) {
        return { markdown: release.changelog, release, areas, stats };
      }

      const { markdown } = this.renderChangelog(release, completed);
      return { markdown, release, areas, stats };
    },
  });

  /**
   * Trim, then test the tag's shape.
   *
   * The pattern is checked HERE rather than folded into `releaseTagSchema`,
   * for the reason `appNameSchema` writes down: a schema rejection fires
   * before the handler runs, so the handler could not trim first. Unlike an
   * app name the tag is NOT lowercased — see `releaseTagSchema.ts`.
   */
  protected assertTag(raw: string): string {
    const tag = raw.trim();
    if (!RELEASE_TAG_PATTERN.test(tag)) {
      throw new BadRequestError(
        "A release tag may contain letters, digits and interior dots, underscores or hyphens - for example `0.28.0`, `v1.0.0-rc.1` or `demo-1`.",
      );
    }
    return tag;
  }

  /**
   * Refuse anything that would rewrite what a published release shipped.
   *
   * `reopenRelease` is the single deliberate way past this.
   */
  protected assertOpen(release: Release): void {
    if (release.releasedAt) {
      throw new BadRequestError(
        "This release has been published. Reopen it before changing what it contains.",
      );
    }
  }

  /**
   * The four progress buckets over a release's quests.
   *
   * Disjoint by construction, so a reader derives the untouched remainder as
   * `total - completed - inProgress - shelved` without a fifth count:
   * `shelvedAt` is only ever set on a quest still in `new` status, so it never
   * coexists with `acceptedAt` or `completedAt`, and `inProgress` excludes
   * both of the others. Same shape as `EpicController.computeProgress`.
   *
   * Called at publish and stamped onto the row. #1555 is what serves it live
   * for an open release.
   */
  protected async computeProgress(release: Release): Promise<{
    completed: number;
    inProgress: number;
    shelved: number;
    total: number;
  }> {
    // Counted over `ReleaseContentService`, never with a `releaseId` count of
    // its own. A release is mostly a set of EPICS, so a direct-attachment
    // count would report 0/0 for the normal case and disagree with the
    // changelog beside it - which is the exact failure the service exists to
    // make impossible.
    const { quests, shelvedQuests } = await this.contents.contentsOf(release);

    return {
      completed: quests.filter((quest) => quest.completedAt != null).length,
      inProgress: quests.filter(
        (quest) => quest.acceptedAt != null && quest.completedAt == null,
      ).length,
      shelved: shelvedQuests.length,
      total: quests.length,
    };
  }

  /**
   * The completed quests attached to a release.
   *
   * This replaced `queryCompletedInWindow`, which asked
   * `completedAt BETWEEN release.createdAt AND (closedAt ?? now)` — a time
   * window, i.e. `git log --since --until` grouped by area. Membership is an
   * assignment now, so the question is which quests were put in the release,
   * not which happened to finish while it was open.
   *
   * Reads `ReleaseContentService` rather than the `releaseId` column, so the
   * changelog and the progress counts are two projections of ONE membership
   * answer and cannot drift apart.
   */
  protected async queryCompleted(release: Release): Promise<Quest[]> {
    const { quests } = await this.contents.contentsOf(release);
    return quests.filter((quest) => quest.completedAt != null);
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
    lines.push(`# Release ${release.tag ?? release.number}: ${release.title}`);
    lines.push("");

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
