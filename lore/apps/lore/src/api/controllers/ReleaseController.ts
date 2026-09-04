import { $inject, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, $sequence, $transactional } from "alepha/orm";
import {
  OwnedResourceProvider,
  type UserAccountToken,
  $secure,
} from "alepha/security";
import {
  $action,
  BadRequestError,
  ForbiddenError,
  okSchema,
} from "alepha/server";
import { $etag } from "alepha/server/etag";

import { type Quest, quests } from "../entities/quests.ts";
import { type Release, releases } from "../entities/releases.ts";
import { compareReleaseTags } from "../releaseOrder.ts";
import {
  type ReleaseChangelogGroup,
  releaseChangelogGroupSchema,
} from "../schemas/releaseChangelogGroupSchema.ts";
import { releaseContentQuestSchema } from "../schemas/releaseContentQuestSchema.ts";
import { releaseResourceSchema } from "../schemas/releaseResourceSchema.ts";
import {
  RELEASE_TAG_PATTERN,
  releaseTagSchema,
} from "../schemas/releaseTagSchema.ts";
import { $ownsProject } from "../security/$ownsProject.ts";
import { LoreAudits } from "../services/LoreAudits.ts";
import { ProjectLimits } from "../services/ProjectLimits.ts";
import {
  type ReleaseContents,
  ReleaseContentService,
} from "../services/ReleaseContentService.ts";

export class ReleaseController {
  releases = $repository(releases);
  quests = $repository(quests);
  dt = $inject(DateTimeProvider);
  audits = $inject(LoreAudits);

  limits = $inject(ProjectLimits);
  contents = $inject(ReleaseContentService);

  /**
   * One project-layer audit row for something that happened to a release.
   *
   * `resourceId` is the **tag**: a release is addressed by its tag
   * (`/:projectSlug/releases/0.28.0`), which is what makes this row a link.
   * `tag` is nullable at the column even though the create schema requires
   * it, so the number stands in rather than writing a row that resolves to
   * nothing.
   */
  protected async logRelease(
    action: string,
    release: {
      id: number;
      number: number;
      tag?: string;
      title: string;
      projectId: number;
    },
    user: UserAccountToken | undefined,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.audits.release.logSuccess(action, {
      ...this.audits.actor(user),
      ...this.audits.scope(release.projectId),
      resourceType: "release",
      resourceId: release.tag ?? String(release.number),
      description: release.title,
      ...(metadata ? { metadata } : {}),
    });
  }
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
      response: z.array(releaseResourceSchema),
    },
    handler: async ({ params }) => {
      const rows = await this.releases.findMany({
        where: {
          projectId: { eq: params.projectId },
        },
        orderBy: [{ column: "number", direction: "desc" }],
      });

      // Batched: two queries for the whole page rather than two per row.
      // Only OPEN releases are looked up at all - a released one renders
      // entirely from its own frozen columns.
      const open = rows.filter((release) => !release.releasedAt);
      const contents = await this.contents.contentsOfMany(
        params.projectId,
        open,
      );

      return (
        rows
          .map((release) => ({
            ...release,
            progress: this.contents.progressOf(
              release,
              contents.get(release.id),
            ),
          }))
          // Version order, and it is settled HERE rather than at each of the
          // dozen surfaces that render this list (#1745, from feedback
          // #2075: "sort release by name / 0.28 -> 0.29 -> 1.0").
          //
          // The SQL above orders by `number`, which is a `$sequence` and so
          // only tracks version order while releases happen to be created in
          // it. Planning `1.0.0` before `0.29.0` breaks the proxy, and one
          // project had already done exactly that - the roadmap read
          // `0.28.0, 1.0.0, 0.29.0`.
          //
          // Ascending, which is what the report asked for and the opposite of
          // the `desc` above: the surfaces that read this list are pickers and
          // filters, where the oldest open release is the one being planned
          // into. The Releases and Epics tables sort themselves and are
          // unaffected.
          //
          // `number` stays as the explicit tiebreak rather than being left to
          // the sort's stability, because the SQL order it would inherit is
          // descending and this ordering is ascending.
          .sort(
            (a, b) => compareReleaseTags(a.tag, b.tag) || a.number - b.number,
          )
      );
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
    handler: async ({ params, body, user }) => {
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

      const release = await this.releases.create({
        projectId: params.projectId,
        number,
        tag,
        title: body.title ?? tag,
        description: body.description ?? "",
        ...(body.targetDate ? { targetDate: body.targetDate } : {}),
      });
      await this.logRelease("create", release, user);

      return release;
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
    handler: async ({ body, user }) => {
      const release = this.owned.get<Release>();
      this.assertOpen(release);

      const withTitle = body.title
        ? { ...release, title: body.title }
        : release;
      // ONE read of the contents for both the changelog and the counts, so
      // the frozen record cannot disagree with itself across two queries.
      const contents = await this.contents.contentsOf(release);
      const { markdown, groups } = this.renderChangelog(withTitle, contents);
      const progress = this.contents.progressOf(release, contents);

      const published = await this.releases.updateById(release.id, {
        releasedAt: this.dt.nowISOString(),
        changelog: markdown,
        // Frozen TOGETHER with the markdown. See `releaseChangelogGroupSchema`
        // for the asymmetry this replaces.
        changelogGroups: groups,
        ...progress,
        ...(body.title ? { title: body.title } : {}),
      });

      // Publishing is one-way and freezes the record, which is exactly what
      // makes it worth a row.
      await this.logRelease("publish", release, user);

      return published;
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
    handler: async ({ params, user }) => {
      const release = this.owned.get<Release>();

      if (!release.releasedAt) {
        throw new BadRequestError("Release is already open.");
      }

      const reopened = await this.releases.updateById(params.id, {
        releasedAt: null,
        changelog: null,
        changelogGroups: null,
        completed: null,
        inProgress: null,
        shelved: null,
        total: null,
      });

      // Beside `publish` rather than left out: a release published, reopened
      // and published again reads as one event without this row.
      await this.logRelease("reopen", release, user);

      return reopened;
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
    handler: async ({ params, body, user }) => {
      this.assertOpen(this.owned.get<Release>());

      const updated = await this.releases.updateById(params.id, {
        ...(body.tag !== undefined ? { tag: this.assertTag(body.tag) } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        ...(body.targetDate !== undefined
          ? { targetDate: body.targetDate ?? null }
          : {}),
      });
      await this.logRelease("update", updated, user, {
        fields: Object.keys(body),
      });

      return updated;
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
    handler: async ({ params, user }) => {
      // Read before the row goes - a deleted id names nothing.
      const release = this.owned.get<Release>();

      // Deleting is deliberately cheap. The old guard refused whenever the
      // release's time window had caught any completed quest, which meant a
      // mistyped release locked itself the moment anything completed anywhere
      // in the project. Membership is an assignment now and
      // `quests.releaseId` is `ON DELETE SET NULL`, so nothing is lost here
      // but the row itself.
      await this.releases.deleteById(params.id);
      await this.logRelease("delete", release, user);
      return { ok: true };
    },
  });

  /**
   * What is in this release, broken down: the attached epics each with their
   * OWN progress inside this release, and the loose quests beside them.
   *
   * ⚠️ Per-epic progress counts only the epic's quests **that are in this
   * release**, not the epic's whole quest set. An epic can carry a quest that
   * names a different release (`ReleaseContentService` lets an explicit
   * attachment override its epic's), and counting that quest here would make
   * the epic bars add up to more than the release bar above them.
   *
   * Each epic carries the very quest ROWS its `completed` and `total` were
   * counted from. The page used to fetch them separately, one `getQuests`
   * per card, filtered by epic and blind to which release each quest names —
   * so a card could print `4/7` above a list of nine rows, four of which
   * belonged to another release. One endpoint, one membership answer, one
   * set of numbers.
   */
  getReleaseContents = $action({
    use: [$secure({ permissions: ["quest:read"] }), this.ownsRelease()],
    schema: {
      params: z.object({
        id: z.integer(),
      }),
      response: z.object({
        epics: z.array(
          z.object({
            id: z.integer(),
            number: z.integer(),
            title: z.string(),
            status: z.string(),
            completed: z.integer(),
            total: z.integer(),
            quests: z.array(releaseContentQuestSchema),
          }),
        ),
        looseQuests: z.array(releaseContentQuestSchema),
      }),
    },
    handler: async () => {
      const release = this.owned.get<Release>();
      const { epics, quests, looseQuests, shelvedQuests } =
        await this.contents.contentsOf(release);

      // `contentsOf` hands back the shelved quests separately, because they
      // are outside every denominator (see `progressOf`). They are still
      // part of what is in the release and are listed as such - struck
      // through rather than hidden, so "we decided not to" is visible
      // instead of looking like work that was never mentioned.
      //
      // Placed by the SAME rule `partition` uses on the unshelved ones: a
      // quest sits under an epic only if that epic is attached to this
      // release, and is loose otherwise. Testing `epicId === epic.id` alone
      // would drop a shelved quest that names this release from inside an
      // epic that does not - it would match no card and fail the `== null`
      // test for the loose group, and vanish from the page entirely.
      const epicIds = new Set(epics.map((epic) => epic.id));
      const under = (quest: Quest, epicId: number) => quest.epicId === epicId;
      const loose = (quest: Quest) =>
        quest.epicId == null || !epicIds.has(quest.epicId);

      return {
        epics: epics.map((epic) => {
          const own = quests.filter((quest) => under(quest, epic.id));
          return {
            id: epic.id,
            number: epic.number,
            title: epic.title,
            status: epic.status,
            completed: own.filter((quest) => quest.completedAt != null).length,
            total: own.length,
            quests: [
              ...own,
              ...shelvedQuests.filter((quest) => under(quest, epic.id)),
            ].map(this.contentQuest),
          };
        }),
        looseQuests: [...looseQuests, ...shelvedQuests.filter(loose)].map(
          this.contentQuest,
        ),
      };
    },
  });

  /**
   * One quest as `getReleaseContents` reports it. A method rather than a
   * closure so both call sites above are provably the same projection.
   */
  protected contentQuest = (quest: Quest) => ({
    id: quest.id,
    shortId: quest.shortId,
    title: quest.title,
    area: quest.area,
    priority: quest.priority,
    completedAt: quest.completedAt,
    acceptedAt: quest.acceptedAt,
    shelvedAt: quest.shelvedAt,
  });

  getReleaseChangelog = $action({
    use: [
      $secure({ permissions: ["quest:read"] }),
      this.ownsRelease(),
      // Same reasoning as `getReleases`: an open release's changelog is
      // recomputed from its contents, so a freshness window hides work that
      // just landed. ETag-only revalidation keeps it cheap.
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
         * `releaseChangelogGroupSchema` for why both projections ship AND
         * why they freeze together.
         */
        groups: z.array(releaseChangelogGroupSchema),
        stats: z.object({
          questCount: z.integer(),
          areaCount: z.integer(),
          contributorCount: z.integer(),
        }),
      }),
    },
    handler: async () => {
      const release = this.owned.get<Release>();

      // A published release renders ENTIRELY from its own row: both
      // projections and the counts, none of them recomputed. The recorder
      // froze the markdown and recomputed the rows, so a quest edited after
      // the close showed a different title in the page than in the `.md`
      // beside it. That asymmetry is deleted rather than ported.
      if (release.releasedAt) {
        const groups = release.changelogGroups ?? [];
        return {
          markdown: release.changelog ?? "",
          release,
          groups,
          stats: {
            questCount: release.completed ?? 0,
            areaCount: groups.length,
            contributorCount: 0,
          },
        };
      }

      const contents = await this.contents.contentsOf(release);
      const { markdown, groups, stats } = this.renderChangelog(
        release,
        contents,
      );
      return { markdown, release, groups, stats };
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
   * Counted over `ReleaseContentService`, never with a `releaseId` count of
   * its own. A release is mostly a set of EPICS, so a direct-attachment count
   * would report 0/0 for the normal case and disagree with the changelog
   * beside it - which is the exact failure the service exists to prevent.
   *
   * Only ever called at publish time, to stamp the frozen columns.
   */
  protected async computeProgress(release: Release): Promise<{
    completed: number;
    inProgress: number;
    shelved: number;
    total: number;
  }> {
    return this.contents.progressOf(
      release,
      await this.contents.contentsOf(release),
    );
  }

  /**
   * The changelog, both projections at once.
   *
   * Grouped by EPIC first, then by area for the quests belonging to no epic
   * in this release: an epic is a headline, a loose quest is a line item.
   * That is what "you open the release, you have the changelog of epics and
   * quests" means.
   *
   * Only COMPLETED quests appear. A changelog reports what shipped; planned
   * work is in the release without being in its changelog, and the progress
   * rollup is what counts both sides.
   */
  protected renderChangelog(
    release: Release,
    contents: ReleaseContents,
  ): {
    markdown: string;
    groups: ReleaseChangelogGroup[];
    stats: { questCount: number; areaCount: number; contributorCount: number };
  } {
    const shipped = contents.quests.filter(
      (quest) => quest.completedAt != null,
    );
    const groups: ReleaseChangelogGroup[] = [];

    // Epics first, in the order `ReleaseContentService` returns them, which
    // is `number` ascending. An epic with nothing completed in it yet is
    // omitted rather than rendered empty: the changelog is what shipped.
    for (const epic of contents.epics) {
      const own = shipped.filter((quest) => quest.epicId === epic.id);
      if (own.length === 0) continue;
      groups.push({
        kind: "epic",
        name: epic.title,
        ref: epic.number,
        questCount: own.length,
        quests: own.map((quest) => this.changelogEntry(quest)),
      });
    }

    // Then the loose work, by area. `looseQuests` is already the set that
    // belongs to no epic of THIS release, so a quest cannot appear under both
    // an epic heading and an area heading.
    const looseShipped = contents.looseQuests.filter(
      (quest) => quest.completedAt != null,
    );
    const byArea = new Map<string, Quest[]>();
    for (const quest of looseShipped) {
      const area = quest.area || "Uncategorized";
      if (!byArea.has(area)) byArea.set(area, []);
      byArea.get(area)!.push(quest);
    }
    for (const [name, areaQuests] of byArea) {
      groups.push({
        kind: "area",
        name,
        questCount: areaQuests.length,
        quests: areaQuests.map((quest) => this.changelogEntry(quest)),
      });
    }

    const contributors = new Set<string>();
    for (const quest of shipped) {
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
      `> ${shipped.length} quest(s) shipped across ${groups.length} section(s) by ${contributors.size} member(s)`,
    );
    lines.push("");

    for (const group of groups) {
      lines.push(
        group.kind === "epic"
          ? `## #${group.ref} ${group.name}`
          : `## ${group.name}`,
      );
      lines.push("");
      for (const quest of group.quests) {
        const priority =
          quest.priority !== "optional" ? ` [${quest.priority}]` : "";
        lines.push(`- ${quest.title}${priority}`);
      }
      lines.push("");
    }

    return {
      markdown: lines.join("\n"),
      groups,
      stats: {
        questCount: shipped.length,
        areaCount: groups.length,
        contributorCount: contributors.size,
      },
    };
  }

  protected changelogEntry(quest: Quest): ReleaseChangelogGroup["quests"][0] {
    return {
      shortId: quest.shortId,
      title: quest.title,
      priority: quest.priority,
    };
  }
}
